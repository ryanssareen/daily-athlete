import "server-only";

// Recipient authorization for AI adaptive proposal decision endpoints
// (plan Unit 6). The proposal's `recipient` column sets accept-authority:
//
//   - recipient = 'athlete' : only the athlete (athlete_id) may decide.
//   - recipient = 'coach'   : only an ACTIVELY-linked coach may decide (the
//                             coach acts on the athlete's behalf, per the
//                             recipient-routing decision). The athlete does NOT
//                             decide a coach-routed proposal.
//
// Shared by [id]/route.ts (read), accept/route.ts, and reject/route.ts so the
// authz rule lives in exactly one place. Mirrors the owner-or-linked-coach gate
// in apps/web/app/api/workouts/[id]/status/route.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeeklyReviewRow } from "@da2/shared";

const PROPOSAL_COLUMNS =
  "id, athlete_id, plan_id, trigger_kind, scope, recipient, status, " +
  "proposed_changes, narrative, event_date_snapshot, earliest_affected_date, " +
  "generated_at, decided_at, created_at, deleted_at";

/** Is `coachId` an active, linked coach of `athleteId`? */
export async function isLinkedCoach(
  admin: SupabaseClient,
  coachId: string,
  athleteId: string
): Promise<boolean> {
  // service-role: explicit user filter required
  const { data, error } = await admin
    .from("coach_athlete_links")
    .select("id")
    .eq("coach_user_id", coachId)
    .eq("athlete_user_id", athleteId)
    .eq("status", "active")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

export type RecipientAuthResult =
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "ok"; review: WeeklyReviewRow };

/**
 * Fetch a proposal by id and verify the caller is its RECIPIENT.
 *
 * Returns a discriminated result the route maps to 404 / 403 / 200. Uses the
 * service-role admin client; the recipient check IS the security boundary.
 */
export async function authorizeRecipient(
  admin: SupabaseClient,
  reviewId: string,
  callerId: string
): Promise<RecipientAuthResult> {
  // service-role: explicit filter on id; recipient check below is the boundary.
  const { data, error } = await admin
    .from("weekly_reviews")
    .select(PROPOSAL_COLUMNS)
    .eq("id", reviewId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { kind: "not_found" };

  const review = data as unknown as WeeklyReviewRow;

  if (review.recipient === "athlete") {
    if (review.athlete_id !== callerId) return { kind: "forbidden" };
    return { kind: "ok", review };
  }

  // recipient === 'coach': only an active linked coach may decide.
  const allowed = await isLinkedCoach(admin, callerId, review.athlete_id);
  if (!allowed) return { kind: "forbidden" };
  return { kind: "ok", review };
}
