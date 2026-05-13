// Mirror of public.workout_matches from
// supabase/migrations/0008_completed_workouts_and_matches.sql. The 1:1 link
// between a planned workout and a completed workout, with a confidence score
// and a method indicating how the link was created.
//
// SQL invariants enforced at the DB layer (NOT Zod refinements here):
// - confidence in [0, 1] (CHECK clause).
// - Two partial unique indexes (one per side, WHERE deleted_at IS NULL)
//   enforce 1:1 cardinality. Re-linking is achieved by soft-deleting the
//   existing match and inserting a new one.
// - workout_matches has NO athlete_id column -- RLS uses EXISTS subqueries
//   against planned_workouts (and completed_workouts on INSERT/UPDATE
//   WITH CHECK). The schema accepts cross-athlete matches at the SQL
//   layer only via service-role (e.g., the matcher worker in product
//   plan Unit 2.4); authenticated callers are blocked by the WITH CHECK
//   on both sides.

import { z } from "zod";

// Matches the SQL CHECK: method IN ('auto_same_day_sport', 'manual_user_link',
// 'merged_from_manual'). Closed enum for v1 matchers.
// - auto_same_day_sport: the default matcher's same-day-sport heuristic
// - manual_user_link: an athlete or coach explicitly linked the two rows
// - merged_from_manual: R21 path where a manual completion was merged
//   into an arriving Strava completion (the match attaches to the Strava
//   canonical row).
export const WorkoutMatchMethodSchema = z.enum([
  "auto_same_day_sport",
  "manual_user_link",
  "merged_from_manual",
]);
export type WorkoutMatchMethod = z.infer<typeof WorkoutMatchMethodSchema>;

// Confidence in [0, 1]. The SQL CHECK enforces the range. Zod mirrors it
// at the API boundary so callers get a clear validation error rather than
// a 23514 from the DB.
//
// Timestamps use .datetime({ offset: true }) per packages/shared convention.
export const WorkoutMatchRowSchema = z.object({
  id: z.string().uuid(),
  planned_workout_id: z.string().uuid(),
  completed_workout_id: z.string().uuid(),
  confidence: z.number().min(0).max(1),
  method: WorkoutMatchMethodSchema,
  matched_at: z.string().datetime({ offset: true }),
  deleted_at: z.string().datetime({ offset: true }).nullable(),
});

export type WorkoutMatchRow = z.infer<typeof WorkoutMatchRowSchema>;
