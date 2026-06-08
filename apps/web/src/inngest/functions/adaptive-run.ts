// Inngest function: adaptive/run.requested
//
// The single per-athlete adaptive-engine runner for EVERY trigger (B1 weekly,
// B2 missed-block, B3 schedule-shock, B4 event-change, B7 workout-swap, R11
// manual). The scheduler (Unit 8), detectors (Unit 9), and on-demand routes
// (Unit 10) all enqueue this one event with their own trigger_kind + scope.
// "One engine, many triggers" — and one runner. See the plan, Units 8-10.
//
// dedup_key controls idempotency: pass a STABLE key (e.g. the ISO-week key) for
// scheduled/detected triggers so overlapping ticks can't double-run; pass a
// UNIQUE key (e.g. a request id) for on-demand triggers that must always run.
//
// Step returns carry counts/ids only (no PII in Inngest history).

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { runEngine } from "@/ai/adaptive/engine";
import { LlmProposer } from "@/ai/adaptive/llm-proposer";
import { localPartsInTimezone } from "@/ai/adaptive/schedule";
import { createLlmClient } from "@/llm";
import { hasActiveEntitlement } from "@/auth/entitlements";
import { createAdminClient } from "@/db/admin";
import { inngest } from "@/inngest/client";
import { ProposalScopeSchema, TriggerKindSchema, type ProposalRecipient } from "@da2/shared";

export const ADAPTIVE_RUN_EVENT = "adaptive/run.requested" as const;

const EventDataSchema = z.object({
  athlete_id: z.string().uuid(),
  trigger_kind: TriggerKindSchema,
  scope: ProposalScopeSchema.default("plan"),
  dedup_key: z.string().default(""),
});

export interface RunContext {
  timezone: string;
  asOf: string; // athlete-local YYYY-MM-DD
  recipient: ProposalRecipient;
}

/**
 * Resolve the per-athlete run context: timezone (default UTC), athlete-local
 * "today", and the proposal recipient (coach when an active coach link exists,
 * else the athlete). Service-role reads with explicit athlete filters.
 */
export async function resolveRunContext(
  admin: SupabaseClient,
  athleteId: string,
  now: Date,
): Promise<RunContext> {
  // service-role: explicit user filter required
  const { data: user } = await admin
    .from("users")
    .select("timezone")
    .eq("id", athleteId)
    .single();
  const timezone = user?.timezone ?? "UTC";

  const p = localPartsInTimezone(timezone, now);
  const asOf = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;

  // service-role: explicit user filter required
  const { data: link } = await admin
    .from("coach_athlete_links")
    .select("id")
    .eq("athlete_user_id", athleteId)
    .eq("status", "active")
    .is("deleted_at", null)
    .limit(1);
  const recipient: ProposalRecipient = link && link.length > 0 ? "coach" : "athlete";

  return { timezone, asOf, recipient };
}

export const adaptiveRun = inngest.createFunction(
  {
    id: "adaptive-run",
    name: "Adaptive engine run (per athlete)",
    concurrency: [{ scope: "fn", key: "event.data.athlete_id", limit: 1 }],
    idempotency:
      "event.data.athlete_id + '-' + event.data.trigger_kind + '-' + event.data.dedup_key",
  },
  { event: ADAPTIVE_RUN_EVENT },
  async ({ event, step, logger }) => {
    const { athlete_id, trigger_kind, scope } = EventDataSchema.parse(event.data);
    const admin = createAdminClient();

    const entitled = await step.run("check-entitlement", () =>
      hasActiveEntitlement(admin, athlete_id, "ai_plans"),
    );
    if (!entitled) {
      logger.info("[adaptive-run] skip_unentitled", { athlete_id, trigger_kind });
      return { skipped: "unentitled" };
    }

    const result = await step.run("run-engine", async () => {
      const ctx = await resolveRunContext(admin, athlete_id, new Date());
      const r = await runEngine({
        admin,
        athleteId: athlete_id,
        triggerKind: trigger_kind,
        scope,
        recipient: ctx.recipient,
        proposer: new LlmProposer(createLlmClient()),
        asOf: ctx.asOf,
      });
      return { outcome: r.outcome, opCount: r.opCount, droppedCount: r.droppedCount };
    });

    logger.info("[adaptive-run] run_complete", { athlete_id, trigger_kind, ...result });
    return result;
  },
);
