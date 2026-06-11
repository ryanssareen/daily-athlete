import "server-only";

// Inngest function: plan/generate.requested (Unit 5).
//
// The worker that turns a 202'd generation request into a persisted plan. It
// reads the RLS-protected attempt row for its inputs (NO inputs/free-text ride
// in the Inngest event — only ids), re-asserts authorization (Inngest events are
// not user-authenticated), generates + validates, and persists via the
// transactional create_ai_plan RPC. Step returns and logs carry ids/counts only
// (no PII in Inngest history).
//
// Idempotency lives in ai_generation_attempts keyed on (athlete_id, request_id):
// a succeeded attempt returns its plan_id with no model spend; a failed attempt
// within cooldown is skipped (negative cache). A fresh re-request mints a new
// request_id and is never blocked by the cache.

import type { SupabaseClient } from "@supabase/supabase-js";
import { NonRetriableError, RetryAfterError } from "inngest";
import { z } from "zod";

import { GeneratePlanInputSchema } from "@da2/shared";

import { isLinkedCoach } from "@/ai/adaptive/recipient-auth";
import { localPartsInTimezone } from "@/ai/adaptive/schedule";
import { gatherGenerationContext } from "@/ai/generation/context";
import { generate } from "@/ai/generation/generate";
import { resolveGenerationAccess } from "@/auth/trial";
import { persistGeneratedPlan } from "@/db/create-ai-plan";
import { createAdminClient } from "@/db/admin";
import { createLlmClient, LlmRateLimited, LlmTransient, type LlmClient } from "@/llm";
import { inngest } from "@/inngest/client";

export const PLAN_GENERATE_EVENT = "plan/generate.requested" as const;

// Negative-cache window: a replay of a FAILED request_id is skipped this long.
const FAILED_COOLDOWN_MS = 60 * 60 * 1000; // 1h

export const PlanGenerateEventDataSchema = z.object({
  athlete_id: z.string().uuid(),
  request_id: z.string().uuid(),
  requester_user_id: z.string().uuid(),
  requester_kind: z.enum(["owner", "coach"]),
});
export type PlanGenerateEventData = z.infer<typeof PlanGenerateEventDataSchema>;

// Closed-enum failure codes. NEVER err.message / prompt / model output.
export type GenerateErrorCode =
  | "no_attempt"
  | "unentitled"
  | "forbidden"
  | "raced"
  | "trial_exhausted"
  | "generation_failed";

export type GeneratePlanResult =
  | { status: "ok"; plan_id: string; workout_count: number | null }
  | { status: "ok_cached"; plan_id: string }
  | { status: "infeasible" }
  | { status: "raced" }
  | { status: "trial_exhausted" }
  | { status: "skipped"; code: GenerateErrorCode };

interface AttemptRow {
  inputs: unknown;
  status: "pending" | "succeeded" | "failed" | "infeasible";
  plan_id: string | null;
  cooldown_until: string | null;
}

/** Mark the attempt row terminal. Service-role; explicit composite-key filter. */
async function markAttempt(
  admin: SupabaseClient,
  athleteId: string,
  requestId: string,
  fields: {
    status: "failed" | "infeasible";
    error_code?: GenerateErrorCode;
    cooldown_until?: string | null;
  }
): Promise<void> {
  // service-role: explicit user filter required
  await admin
    .from("ai_generation_attempts")
    .update({
      status: fields.status,
      error_code: fields.error_code ?? null,
      failed_at: new Date().toISOString(),
      cooldown_until: fields.cooldown_until ?? null,
    })
    .eq("athlete_id", athleteId)
    .eq("request_id", requestId);
}

export interface RunGeneratePlanDeps {
  admin: SupabaseClient;
  /** Injected so tests use a mocked client; the worker passes createLlmClient(). */
  client: LlmClient;
  event: PlanGenerateEventData;
  /** Injected for a deterministic athlete-local "today"; defaults to now. */
  now?: Date;
}

/**
 * The generation core, extracted from the Inngest wrapper so it is unit-testable
 * against a real Postgres + a mocked LlmClient. Rate-limit / transient client
 * errors PROPAGATE (the wrapper maps them to RetryAfterError / retry); every
 * terminal outcome marks the attempt row and returns a typed result.
 */
export async function runGeneratePlan(
  deps: RunGeneratePlanDeps
): Promise<GeneratePlanResult> {
  const { admin, client, event } = deps;
  const { athlete_id, request_id, requester_user_id, requester_kind } = event;

  // 1. Read the attempt row (holds the inputs; never in the event).
  // service-role: explicit user filter required
  const { data: attempt, error: readErr } = await admin
    .from("ai_generation_attempts")
    .select("inputs, status, plan_id, cooldown_until")
    .eq("athlete_id", athlete_id)
    .eq("request_id", request_id)
    .maybeSingle<AttemptRow>();
  if (readErr) throw new Error(`attempt read failed: ${readErr.message}`);
  if (!attempt) return { status: "skipped", code: "no_attempt" };

  // Idempotency: a prior success is a no-op (no model spend).
  if (attempt.status === "succeeded" && attempt.plan_id) {
    return { status: "ok_cached", plan_id: attempt.plan_id };
  }
  // Negative cache: a failed replay within cooldown is skipped.
  if (
    attempt.status === "failed" &&
    attempt.cooldown_until &&
    new Date(attempt.cooldown_until).getTime() > (deps.now ?? new Date()).getTime()
  ) {
    return { status: "skipped", code: "generation_failed" };
  }

  // 2. Re-assert authorization (events are not user-authenticated).
  if (requester_kind === "coach") {
    const linked = await isLinkedCoach(admin, requester_user_id, athlete_id);
    if (!linked) {
      await markAttempt(admin, athlete_id, request_id, {
        status: "failed",
        error_code: "forbidden",
        cooldown_until: new Date((deps.now ?? new Date()).getTime() + FAILED_COOLDOWN_MS).toISOString(),
      });
      return { status: "skipped", code: "forbidden" };
    }
  }
  const access = await resolveGenerationAccess(admin, athlete_id);
  if (!access.allowed) {
    await markAttempt(admin, athlete_id, request_id, {
      status: "failed",
      error_code: "unentitled",
      cooldown_until: new Date((deps.now ?? new Date()).getTime() + FAILED_COOLDOWN_MS).toISOString(),
    });
    return { status: "skipped", code: "unentitled" };
  }

  // 3. Parse inputs + derive athlete-local "today".
  const input = GeneratePlanInputSchema.parse(attempt.inputs);
  const asOf = await resolveAthleteToday(admin, athlete_id, deps.now ?? new Date());

  // 4. Generate (rate-limit/transient propagate; invalid-output -> infeasible).
  const ctx = await gatherGenerationContext(admin, athlete_id, asOf);
  const result = await generate(input, ctx, { client, today: asOf });

  if (result.status === "infeasible") {
    // The athlete-facing reason is generic by design; the debug block is the
    // ONLY diagnosable record of which gate fired (stage + last error/violation
    // + model-call count). Ids and gate detail only — never athlete free-text.
    console.error(
      "[generate-plan] infeasible",
      JSON.stringify({
        athlete_id,
        request_id,
        stage: result.debug.stage,
        detail: result.debug.detail,
        model_calls: result.debug.modelCalls,
      })
    );
    await markAttempt(admin, athlete_id, request_id, { status: "infeasible" });
    return { status: "infeasible" };
  }

  // 5. Persist transactionally (the RPC marks the attempt succeeded on ok).
  const outcome = await persistGeneratedPlan({
    athleteId: athlete_id,
    requestId: request_id,
    plan: result.plan,
    consumeTrial: access.trialEligible,
    admin,
  });

  if (outcome.outcome === "ok") {
    return { status: "ok", plan_id: outcome.plan_id, workout_count: outcome.workout_count };
  }
  if (outcome.outcome === "trial_exhausted") {
    await markAttempt(admin, athlete_id, request_id, {
      status: "failed",
      error_code: "trial_exhausted",
    });
    return { status: "trial_exhausted" };
  }
  // raced: a cross-writer replaced the active plan; surface "retry".
  await markAttempt(admin, athlete_id, request_id, {
    status: "failed",
    error_code: "raced",
    cooldown_until: new Date((deps.now ?? new Date()).getTime() + FAILED_COOLDOWN_MS).toISOString(),
  });
  return { status: "raced" };
}

/** Athlete-local YYYY-MM-DD (default UTC). Mirrors adaptive-run's resolution. */
async function resolveAthleteToday(
  admin: SupabaseClient,
  athleteId: string,
  now: Date
): Promise<string> {
  // service-role: explicit user filter required
  const { data: user, error } = await admin
    .from("users")
    .select("timezone")
    .eq("id", athleteId)
    .single();
  if (error) throw error;
  const tz = (user?.timezone as string | null) ?? "UTC";
  const p = localPartsInTimezone(tz, now);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export const generatePlan = inngest.createFunction(
  {
    id: "generate-plan",
    name: "AI plan generation (per athlete)",
    // Each attempt re-runs the generator (model spend), so bound retries; the
    // RPC + idempotency key make a retry safe (a succeeded attempt no-ops).
    retries: 3,
    concurrency: [{ scope: "fn", key: "event.data.athlete_id", limit: 1 }],
    idempotency: "event.data.athlete_id + '-' + event.data.request_id",
    onFailure: async ({ event, error, step, logger }) => {
      // Retries exhausted (or a non-retriable terminal): record the attempt as
      // failed with a closed-enum code. event.data is the failure envelope.
      const data = PlanGenerateEventDataSchema.parse(event.data.event.data);
      const admin = createAdminClient();
      // Closed-enum code only — never error.message / prompt / output.
      const code: GenerateErrorCode = "generation_failed";
      void error;
      await step.run("mark-failed", () =>
        markAttempt(admin, data.athlete_id, data.request_id, {
          status: "failed",
          error_code: code,
          cooldown_until: new Date(Date.now() + FAILED_COOLDOWN_MS).toISOString(),
        })
      );
      logger.error("[generate-plan] failed", {
        athlete_id: data.athlete_id,
        request_id: data.request_id,
        error_code: code,
      });
    },
  },
  { event: PLAN_GENERATE_EVENT },
  async ({ event, step, logger }) => {
    const data = PlanGenerateEventDataSchema.parse(event.data);
    const admin = createAdminClient();

    const result = await step.run("generate-and-persist", async () => {
      try {
        return await runGeneratePlan({ admin, client: createLlmClient(), event: data });
      } catch (err) {
        // Map typed LLM failures to Inngest retry semantics (mirrors
        // backfill-strava.ts / adaptive-run.ts). Fixed codes only.
        if (err instanceof LlmRateLimited) {
          throw new RetryAfterError(
            "llm_rate_limited",
            (err.retryAfterSeconds ?? 60) * 1000,
            { cause: err }
          );
        }
        if (err instanceof LlmTransient) throw err; // bounded retry
        throw err; // unexpected -> bounded retry, then onFailure
      }
    });

    logger.info("[generate-plan] complete", {
      athlete_id: data.athlete_id,
      request_id: data.request_id,
      status: result.status,
    });
    return result;
  }
);
