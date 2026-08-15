import "server-only";

// Data access for public.plans: list/get (plain queries) and archive/delete
// (RPC-backed, see supabase/migrations/0027_plans_archive_delete_rpc.sql).
//
// All four functions take the admin (service-role) client plus the resolved
// athlete id and filter every query by athlete_id explicitly -- this client
// bypasses RLS entirely, so there is no backstop if a filter is dropped.
//
// archivePlan/softDeletePlan call SECURITY DEFINER RPCs rather than issuing
// their own UPDATEs: the plan-row transition must be atomic with retiring the
// plan's not-yet-done planned_workouts rows (a crash between two separate
// admin-client calls would leave a plan archived/deleted with its workouts
// still live on the calendar), and supabase-js has no ad hoc multi-statement
// transaction primitive. See docs/plans/2026-08-15-001-feat-plan-history-archive-delete-plan.md
// (Unit 1, KTD6).

import type { SupabaseClient } from "@supabase/supabase-js";
import { type PlanRow, PlanRowSchema } from "@da2/shared";

const PLAN_COLUMNS =
  "id, athlete_id, status, event_type, event_date, source, " +
  "created_from_review_id, created_at, archived_at, deleted_at";

export type PlanActionResult =
  | { ok: true; plan: PlanRow }
  | { ok: false; reason: "not_found" };

/**
 * Lists an athlete's plans (active + archived, excludes soft-deleted),
 * newest first. Returns an empty array (not an error) when the athlete has
 * no plans.
 */
export async function listPlans(
  admin: SupabaseClient,
  athleteId: string
): Promise<PlanRow[]> {
  // service-role: explicit user filter required
  const { data, error } = await admin
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`listPlans failed: ${error.message}`);
  }
  return (data ?? []).map((row) => PlanRowSchema.parse(row));
}

/**
 * Returns a single plan owned by the given athlete, or null if it doesn't
 * exist, isn't owned by this athlete, or is soft-deleted. Ownership mismatch
 * and not-found are indistinguishable by design (see R6 in the plan doc) --
 * callers should map null to a 404, never a 403.
 */
export async function getPlan(
  admin: SupabaseClient,
  athleteId: string,
  planId: string
): Promise<PlanRow | null> {
  // service-role: explicit user filter required
  const { data, error } = await admin
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("id", planId)
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`getPlan failed: ${error.message}`);
  }
  if (!data) return null;
  return PlanRowSchema.parse(data);
}

interface RpcOutcome {
  outcome: "ok" | "not_found";
  plan?: unknown;
}

/**
 * Archives an active plan (idempotent: already-archived is a no-op success)
 * and cascades to soft-delete its not-yet-done planned_workouts, via the
 * archive_plan RPC. Never resurrects a soft-deleted plan -- one is reported
 * as not_found, same as a plan that never existed or isn't owned by this
 * athlete.
 */
export async function archivePlan(
  admin: SupabaseClient,
  athleteId: string,
  planId: string
): Promise<PlanActionResult> {
  const { data, error } = await admin.rpc("archive_plan", {
    p_athlete_id: athleteId,
    p_plan_id: planId,
  });
  if (error) {
    throw new Error(`archivePlan failed: ${error.message}`);
  }
  return parseRpcOutcome(data as RpcOutcome);
}

/**
 * Soft-deletes a plan (idempotent: already-deleted is a no-op success) and
 * cascades to soft-delete its not-yet-done planned_workouts, via the
 * soft_delete_plan RPC. Works directly on an active plan -- does not require
 * archiving first.
 */
export async function softDeletePlan(
  admin: SupabaseClient,
  athleteId: string,
  planId: string
): Promise<PlanActionResult> {
  const { data, error } = await admin.rpc("soft_delete_plan", {
    p_athlete_id: athleteId,
    p_plan_id: planId,
  });
  if (error) {
    throw new Error(`softDeletePlan failed: ${error.message}`);
  }
  return parseRpcOutcome(data as RpcOutcome);
}

function parseRpcOutcome(data: RpcOutcome): PlanActionResult {
  if (!data || data.outcome === "not_found") {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true, plan: PlanRowSchema.parse(data.plan) };
}
