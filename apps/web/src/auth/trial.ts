import "server-only";

// One-free-plan trial gate (Unit 7).
//
// A never-paid user may generate exactly ONE AI plan before the paywall. The
// durable marker is a row in public.ai_plan_trials (migration 0024); its mere
// existence == the trial is spent. Consumption is atomic inside create_ai_plan
// (flipped in the same transaction as the plan insert), so this module only
// READS eligibility — both the route and the worker call resolveGenerationAccess
// to gate, and the RPC is the race-safe source of truth on consumption.

import type { SupabaseClient } from "@supabase/supabase-js";

import { hasActiveEntitlement } from "@/auth/entitlements";

/** True iff the user has not yet consumed their single free trial plan. Reads
 * only the marker — entitlement is checked separately by the caller. */
export async function isTrialEligible(
  client: SupabaseClient,
  userId: string
): Promise<boolean> {
  // service-role: explicit user filter required
  const { data, error } = await client
    .from("ai_plan_trials")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    // Fail closed: a read error must not hand out a free plan.
    console.error(
      "[trial] isTrialEligible query failed",
      JSON.stringify({ user_id: userId, code: error.code })
    );
    return false;
  }
  return data === null;
}

export interface GenerationAccess {
  /** May generation proceed at all (entitled OR trial-eligible)? */
  allowed: boolean;
  /** Holds an active paid ai_plans entitlement. */
  entitled: boolean;
  /** Not entitled, but the one free trial is still available. */
  trialEligible: boolean;
}

/**
 * The generation gate shared by the route (402 on `!allowed`) and the worker
 * (defense-in-depth re-check). `trialEligible` doubles as the "consume the
 * trial" signal passed to the RPC — an entitled user never spends a trial.
 */
export async function resolveGenerationAccess(
  admin: SupabaseClient,
  athleteId: string
): Promise<GenerationAccess> {
  const entitled = await hasActiveEntitlement(admin, athleteId, "ai_plans");
  if (entitled) {
    return { allowed: true, entitled: true, trialEligible: false };
  }
  const trialEligible = await isTrialEligible(admin, athleteId);
  return { allowed: trialEligible, entitled: false, trialEligible };
}
