import "server-only";

// appendWorkoutEdit — append a row to the append-only public.workout_edits
// audit log (migration 0019). Every planned_workout edit — athlete, coach, or
// ai_review — appends a row here so the audit log is COMPLETE, not AI-only.
// This makes the coach-overwrite guardrail (plan Unit 4) trustworthy: it keys
// off edited_by_kind, and an authoritative attribution + a complete edit log
// are its prerequisites (plan Unit 2).
//
// The table is service-role-write-only (no INSERT policy for the authenticated
// role) and append-only (a BEFORE UPDATE/DELETE immutability trigger blocks
// mutation even for service-role). This helper therefore only ever INSERTs.
//
// SECURITY: takes a service-role admin client. athlete_id is always set
// explicitly from the resolved owner of the workout, never inferred — RLS is
// not running on this client.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { WorkoutEditActorRole, WorkoutEditFieldDiff } from "@da2/shared";

export interface AppendWorkoutEditArgs {
  /** Service-role admin client (RLS bypassed — caller supplies explicit ids). */
  admin: SupabaseClient;
  /** Owner of the edited workout. Always the planned_workout's athlete_id. */
  athleteId: string;
  /** The edited planned workout. NULL only on the account-cascade scrub path. */
  plannedWorkoutId: string;
  /** Who made the edit: 'athlete' | 'coach' | 'ai_review'. */
  actorRole: WorkoutEditActorRole;
  /** The user who performed the edit (the authenticated caller). */
  actorUserId: string;
  /** Field-level before/after diff of the plannable columns that changed. */
  fieldDiff: WorkoutEditFieldDiff;
  /**
   * Back-reference to the proposal that produced this edit. NULL for direct
   * athlete/coach edits; set only on the ai_review apply path (plan Unit 6).
   */
  weeklyReviewId?: string | null;
}

/**
 * Appends a single workout_edits row. Throws on DB error so callers can decide
 * whether the audit gap should fail the request (the status route logs + 500s
 * on its overall edit path). Returns the new row id.
 */
export async function appendWorkoutEdit(
  args: AppendWorkoutEditArgs,
): Promise<string> {
  const {
    admin,
    athleteId,
    plannedWorkoutId,
    actorRole,
    actorUserId,
    fieldDiff,
    weeklyReviewId = null,
  } = args;

  // service-role: explicit user filter required (athlete_id set from the
  // resolved workout owner, never inferred from the client identity).
  const { data, error } = await admin
    .from("workout_edits")
    .insert({
      athlete_id: athleteId,
      planned_workout_id: plannedWorkoutId,
      actor_role: actorRole,
      actor_user_id: actorUserId,
      weekly_review_id: weeklyReviewId,
      field_diff: fieldDiff,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `appendWorkoutEdit failed: ${error?.message ?? "no data returned"}`,
    );
  }

  return data.id as string;
}
