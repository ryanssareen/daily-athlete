import "server-only";

// Service-role caller for the create_ai_plan RPC (migration 0024).
//
// The RPC owns the transactional archive-then-create + idempotency + trial flip;
// this is the thin Node seam that invokes it with the admin client and maps the
// typed JSONB outcome onto a discriminated union the worker branches on. Never
// derives athlete_id/plan_id from model output — only ids the worker already
// holds are passed.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeneratedPlan } from "@da2/shared";

import { createAdminClient } from "@/db/admin";

export type CreateAiPlanOutcome =
  | { outcome: "ok"; plan_id: string; workout_count: number | null; idempotent: boolean }
  | { outcome: "raced" }
  | { outcome: "trial_exhausted" };

export interface PersistGeneratedPlanArgs {
  athleteId: string;
  requestId: string;
  plan: GeneratedPlan;
  /** Flip the one-free-plan marker in the same transaction (Unit 7). True only
   * when the generation is running on the trial path (not entitled). */
  consumeTrial: boolean;
  /** Injectable for tests; defaults to a fresh service-role client. */
  admin?: SupabaseClient;
}

/**
 * Persist a generated plan via the transactional RPC. Throws on an unexpected
 * DB error (e.g. a malformed-workout CHECK rollback); returns a typed outcome
 * for the expected branches (ok / raced / trial_exhausted).
 */
export async function persistGeneratedPlan(
  args: PersistGeneratedPlanArgs
): Promise<CreateAiPlanOutcome> {
  const admin = args.admin ?? createAdminClient();
  const { plan } = args;

  const { data, error } = await admin.rpc("create_ai_plan", {
    p_athlete_id: args.athleteId,
    p_request_id: args.requestId,
    // Only the two persisted plan-level fields; narrative is not stored (v1).
    p_plan: { event_type: plan.event_type, event_date: plan.event_date },
    p_workouts: plan.workouts,
    p_consume_trial: args.consumeTrial,
  });

  if (error) {
    throw new Error(`create_ai_plan rpc failed: ${error.message}`);
  }

  return (data ?? { outcome: "raced" }) as CreateAiPlanOutcome;
}
