// Plan generation orchestrator: feasibility gate -> structured model call (with
// parse-retry) -> content gate (hard reject) -> whole-plan safety validation
// (regenerate-with-feedback) -> ok | infeasible.
//
// A hard global model-call ceiling bounds cost-DoS regardless of which retry
// layer fires. Rate-limit / transient client errors PROPAGATE so the Inngest
// worker maps them to RetryAfterError instead of burning the ceiling.
//
// Every infeasible result carries a `debug` block (stage + detail + call
// count) for the worker to log — the athlete-facing `reason` is deliberately
// generic, so without the debug block a prod failure is undiagnosable (issue
// #93 reopen: every generation returned infeasible with no way to tell which
// gate fired).

import {
  GeneratedPlanSchema,
  type GeneratePlanInput,
  type GeneratedPlan,
} from "@da2/shared";

import { isLlmBackOff, type LlmClient } from "@/llm";

import { checkPlanContent } from "./content-gate";
import type { GenerationContext } from "./context";
import { assessFeasibility } from "./feasibility";
import { buildGenerationPrompt } from "./prompts/generate-plan";
import { validateGeneratedPlan } from "./validate-plan";

/** Which gate produced an infeasible result (for logs/triage, never the UI). */
export type InfeasibleStage =
  | "feasibility"
  | "parse_exhausted"
  | "content_gate"
  | "validator_exhausted"
  | "call_ceiling";

export interface InfeasibleDebug {
  stage: InfeasibleStage;
  /** Last parse error / violation list / gate reason. No athlete free-text. */
  detail: string;
  modelCalls: number;
}

export type GenerateResult =
  | { status: "ok"; plan: GeneratedPlan }
  | { status: "infeasible"; reason: string; debug: InfeasibleDebug };

// Attempts per structured call to recover from malformed JSON (feeds the Zod
// error back). Regenerations to recover from an UNSAFE-but-valid plan (feeds the
// violation back). The global ceiling caps total spend across both loops.
export const MAX_PARSE_ATTEMPTS = 3;
export const MAX_REGEN_ATTEMPTS = 2;
export const MAX_MODEL_CALLS = 15;

const RETRY_MSG = "We couldn't generate a plan right now. Please try again.";
const SAFETY_MSG =
  "We couldn't build a plan within safe training limits for this goal.";

export interface GenerateDeps {
  client: LlmClient;
  /** Today's date (YYYY-MM-DD), injected for deterministic feasibility. */
  today: string;
}

export async function generate(
  input: GeneratePlanInput,
  ctx: GenerationContext,
  deps: GenerateDeps
): Promise<GenerateResult> {
  const feasibility = assessFeasibility(input, deps.today);
  if (!feasibility.feasible) {
    return {
      status: "infeasible",
      reason: feasibility.reason ?? SAFETY_MSG,
      debug: {
        stage: "feasibility",
        detail: feasibility.reason ?? "no reason",
        modelCalls: 0,
      },
    };
  }

  let calls = 0;
  let violationFeedback: string | undefined;

  for (let regen = 0; regen <= MAX_REGEN_ATTEMPTS; regen++) {
    let priorError: string | undefined;
    let plan: GeneratedPlan | undefined;

    for (let attempt = 0; attempt < MAX_PARSE_ATTEMPTS; attempt++) {
      if (calls >= MAX_MODEL_CALLS) {
        return {
          status: "infeasible",
          reason: RETRY_MSG,
          debug: {
            stage: "call_ceiling",
            detail: `hit MAX_MODEL_CALLS=${MAX_MODEL_CALLS}; last error: ${priorError ?? violationFeedback ?? "none"}`,
            modelCalls: calls,
          },
        };
      }
      calls++;
      const { system, prompt } = buildGenerationPrompt(input, ctx, {
        priorError,
        violationFeedback,
      });
      let raw: unknown;
      try {
        const result = await deps.client.generateStructured({
          system,
          prompt,
          schema: GeneratedPlanSchema,
          traceName: "generate.plan",
        });
        raw = result.json;
        console.info(
          "[generate-plan] llm_call",
          JSON.stringify({
            call: calls,
            regen,
            attempt,
            input_tokens: result.usage.inputTokens,
            output_tokens: result.usage.outputTokens,
            latency_ms: result.usage.latencyMs,
          })
        );
      } catch (err) {
        // Back-off cases propagate; the worker turns them into RetryAfterError.
        if (isLlmBackOff(err)) throw err;
        priorError = err instanceof Error ? err.message : "invalid model output";
        console.warn(
          "[generate-plan] llm_call_invalid",
          JSON.stringify({ call: calls, regen, attempt, error: priorError })
        );
        continue;
      }
      const parsed = GeneratedPlanSchema.safeParse(raw);
      if (!parsed.success) {
        // Path-qualified, multi-issue feedback (mirrors propose.ts parseAll).
        // A bare issues[0].message is often just "Required" — useless to steer
        // an open-weight model that wrapped the plan in an envelope object.
        priorError =
          parsed.error.issues
            .slice(0, 5)
            .map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`)
            .join("; ") || "invalid plan shape";
        console.warn(
          "[generate-plan] parse_failed",
          JSON.stringify({ call: calls, regen, attempt, error: priorError })
        );
        continue;
      }
      plan = parsed.data;
      break;
    }

    if (!plan) {
      return {
        status: "infeasible",
        reason: RETRY_MSG,
        debug: {
          stage: "parse_exhausted",
          detail: priorError ?? "no parse error captured",
          modelCalls: calls,
        },
      };
    }

    // Content gate is a HARD reject — no regeneration (a medical/injection echo
    // signals adversarial/broken output retries won't fix).
    const content = checkPlanContent(plan);
    if (!content.ok) {
      return {
        status: "infeasible",
        reason: RETRY_MSG,
        debug: {
          stage: "content_gate",
          detail: content.reason ?? "content gate rejected",
          modelCalls: calls,
        },
      };
    }

    const validation = validateGeneratedPlan(plan, ctx.load);
    if (validation.valid) return { status: "ok", plan };
    violationFeedback = validation.violations.map((v) => v.detail).join("; ");
    console.warn(
      "[generate-plan] validation_failed",
      JSON.stringify({
        call: calls,
        regen,
        violations: validation.violations.map((v) => v.code),
        detail: violationFeedback,
        seed_ctl: Math.round(ctx.load.seedCtl),
        recent_weekly_tss: ctx.load.recentWeeklyTss ?? null,
      })
    );
  }

  return {
    status: "infeasible",
    reason: SAFETY_MSG,
    debug: {
      stage: "validator_exhausted",
      detail: violationFeedback ?? "no violations captured",
      modelCalls: calls,
    },
  };
}
