// Mirror of public.workout_edits from
// supabase/migrations/0019_weekly_reviews_and_workout_edits.sql. The append-only
// audit log of every planned_workout edit -- athlete, coach, or ai_review. See
// docs/plans/2026-05-25-001-feat-ai-adaptive-plans-engine-plan.md (Units 1, 2, 6).
//
// SQL invariants enforced at the DB layer (NOT Zod refinements here):
// - Append-only: a BEFORE UPDATE trigger blocks all updates except the
//   actor_user_id ON DELETE SET NULL scrub. There is no app DELETE path (no
//   DELETE policy); DELETE is reserved for the account-deletion cascade.
// - Service-role INSERT only.

import { z } from "zod";

// Who made the edit. `ai_review` rows carry a weekly_review_id back-reference.
export const WorkoutEditActorRoleSchema = z.enum(["athlete", "coach", "ai_review"]);
export type WorkoutEditActorRole = z.infer<typeof WorkoutEditActorRoleSchema>;

// Field-level diff of the plannable columns that changed. Permissive JSONB at
// the SQL layer; shape stays open (it records before/after of whichever
// plannable fields an edit touched).
export const WorkoutEditFieldDiffSchema = z.object({}).passthrough();
export type WorkoutEditFieldDiff = z.infer<typeof WorkoutEditFieldDiffSchema>;

export const WorkoutEditRowSchema = z.object({
  id: z.string().uuid(),
  athlete_id: z.string().uuid(),
  // Nullable: the workout may be hard-deleted (account cascade) after the edit.
  planned_workout_id: z.string().uuid().nullable(),
  // Back-reference to the proposal that produced this edit (NULL for direct
  // athlete/coach edits).
  weekly_review_id: z.string().uuid().nullable(),
  actor_role: WorkoutEditActorRoleSchema,
  // Nullable: a coach actor may be deleted (SET NULL scrub) while the athlete's
  // audit row is retained.
  actor_user_id: z.string().uuid().nullable(),
  field_diff: WorkoutEditFieldDiffSchema,
  created_at: z.string().datetime({ offset: true }),
});
export type WorkoutEditRow = z.infer<typeof WorkoutEditRowSchema>;
