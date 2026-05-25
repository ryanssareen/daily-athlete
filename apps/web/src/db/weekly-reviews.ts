import "server-only";

// Service-role helpers for public.weekly_reviews (migration 0019).
//
// The proposal lifecycle is RPC-only for status writes; these helpers cover the
// engine's *insert* paths (Unit 5):
//  - getOpenPlanScopedProposal: the pending plan-scoped proposal (precedence input).
//  - proposePlanScopedReview:   thin wrapper over the propose_weekly_review RPC
//    (migration 0023) — atomic, serialized supersede/suppress-then-insert.
//  - insertWorkoutScopedReview: direct insert for B7 workout-scoped proposals,
//    which are exempt from the single-open index (they never call the RPC).
//  - insertNoChanges:           direct insert of a terminal `no_changes` row,
//    which must NOT route through the RPC (no_changes must never supersede a
//    pending real proposal).
//
// SECURITY: all take a service-role admin client (crons / Inngest run with no
// user JWT). athlete_id / plan_id are always set explicitly from resolved
// context — RLS is bypassed. // service-role: explicit user filter required

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ProposalRecipient,
  ProposalScope,
  ProposedEdit,
  TriggerKind,
} from "@da2/shared";

/** A pending plan-scoped proposal (precedence + race-detection input). */
export interface OpenProposal {
  id: string;
  trigger_kind: TriggerKind;
}

/**
 * The single open plan-scoped proposal for an athlete, or null. Mirrors the
 * partial unique index `weekly_reviews_one_open_plan_scoped` predicate. Read
 * BEFORE deciding precedence; the RPC re-checks under the advisory lock (this
 * read is advisory only — the RPC is the authoritative serializer).
 */
export async function getOpenPlanScopedProposal(
  admin: SupabaseClient,
  athleteId: string
): Promise<OpenProposal | null> {
  // service-role: explicit user filter required
  const { data, error } = await admin
    .from("weekly_reviews")
    .select("id, trigger_kind")
    .eq("athlete_id", athleteId)
    .eq("scope", "plan")
    .eq("status", "proposed")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`getOpenPlanScopedProposal failed: ${error.message}`);
  }
  return (data as OpenProposal | null) ?? null;
}

export interface ProposePlanScopedArgs {
  admin: SupabaseClient;
  athleteId: string;
  planId: string;
  triggerKind: TriggerKind;
  recipient: ProposalRecipient;
  proposedChanges: ProposedEdit[];
  narrative: string | null;
  eventDateSnapshot: string | null;
  earliestAffectedDate: string | null;
}

/**
 * Insert a plan-scoped proposal via the propose_weekly_review RPC (atomic
 * supersede/suppress-then-insert under a per-athlete advisory lock).
 *
 * Returns the new weekly_reviews id, or null when SUPPRESSED (a higher-priority
 * proposal is pending — the RPC returns NULL). A commit-time 23505 (a concurrent
 * winner inserted first) is NOT caught here — callers (persist.ts) treat it as a
 * clean no-op ("another proposal won; do not retry the LLM call").
 */
export async function proposePlanScopedReview(
  args: ProposePlanScopedArgs
): Promise<string | null> {
  const { admin } = args;
  // service-role: explicit user filter required (p_athlete_id set explicitly)
  const { data, error } = await admin.rpc("propose_weekly_review", {
    p_athlete_id: args.athleteId,
    p_plan_id: args.planId,
    p_trigger_kind: args.triggerKind,
    p_recipient: args.recipient,
    p_proposed_changes: args.proposedChanges,
    p_narrative: args.narrative,
    p_event_date_snapshot: args.eventDateSnapshot,
    p_earliest_affected_date: args.earliestAffectedDate,
    p_status: "proposed",
  });

  if (error) {
    // Re-throw so persist.ts can classify a 23505 as a clean no-op vs. a real error.
    const err = new Error(`propose_weekly_review failed: ${error.message}`);
    (err as { code?: string }).code = (error as { code?: string }).code;
    throw err;
  }

  // RPC returns the new id, or NULL when suppressed.
  return (data as string | null) ?? null;
}

export interface InsertWorkoutScopedArgs {
  admin: SupabaseClient;
  athleteId: string;
  planId: string;
  triggerKind: TriggerKind;
  recipient: ProposalRecipient;
  proposedChanges: ProposedEdit[];
  narrative: string | null;
  eventDateSnapshot: string | null;
  earliestAffectedDate: string | null;
}

/**
 * Direct insert of a workout-scoped (B7) proposal. Scope-exempt from the
 * single-open index, so it does NOT call the RPC. Returns the new id.
 */
export async function insertWorkoutScopedReview(
  args: InsertWorkoutScopedArgs
): Promise<string> {
  const { admin } = args;
  // service-role: explicit user filter required (athlete_id set explicitly)
  const { data, error } = await admin
    .from("weekly_reviews")
    .insert({
      athlete_id: args.athleteId,
      plan_id: args.planId,
      trigger_kind: args.triggerKind,
      scope: "workout" satisfies ProposalScope,
      recipient: args.recipient,
      status: "proposed",
      proposed_changes: args.proposedChanges,
      narrative: args.narrative,
      event_date_snapshot: args.eventDateSnapshot,
      earliest_affected_date: args.earliestAffectedDate,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `insertWorkoutScopedReview failed: ${error?.message ?? "no data returned"}`
    );
  }
  return data.id as string;
}

export interface InsertNoChangesArgs {
  admin: SupabaseClient;
  athleteId: string;
  planId: string;
  triggerKind: TriggerKind;
  scope: ProposalScope;
  recipient: ProposalRecipient;
  narrative: string | null;
  eventDateSnapshot: string | null;
}

/**
 * Insert a terminal `no_changes` row directly (NOT via the RPC). A no_changes
 * outcome must never supersede a pending real proposal, so it bypasses the
 * precedence path entirely. proposed_changes is an empty list. Returns the id.
 */
export async function insertNoChanges(args: InsertNoChangesArgs): Promise<string> {
  const { admin } = args;
  // service-role: explicit user filter required (athlete_id set explicitly)
  const { data, error } = await admin
    .from("weekly_reviews")
    .insert({
      athlete_id: args.athleteId,
      plan_id: args.planId,
      trigger_kind: args.triggerKind,
      scope: args.scope,
      recipient: args.recipient,
      status: "no_changes",
      proposed_changes: [],
      narrative: args.narrative,
      event_date_snapshot: args.eventDateSnapshot,
      earliest_affected_date: null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`insertNoChanges failed: ${error?.message ?? "no data returned"}`);
  }
  return data.id as string;
}
