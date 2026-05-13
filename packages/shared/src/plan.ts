// Mirror of public.plans from supabase/migrations/0007_plans_and_planned_workouts.sql.
// Coarse-grained training plan; at most one active per athlete (enforced by
// partial unique index plans_one_active_per_athlete). Switching events
// archives the previous and creates a new one.
//
// `created_from_review_id` is a plain UUID with NO FK constraint -- the FK
// to weekly_reviews(id) is deferred to schema plan Unit 7's migration. The
// Zod schema therefore validates UUID format only, not referential integrity.
// See R7-R10 in docs/brainstorms/2026-05-02-database-schema-requirements.md.

import { z } from "zod";

// Matches the SQL CHECK: status IN ('active', 'archived').
// CHECK constraint plans_archived_at_matches_status additionally enforces
// archived_at IS NOT NULL when status='archived'; that is a row-level
// invariant tested separately, not a Zod refinement here.
export const PlanStatusSchema = z.enum(["active", "archived"]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

// Matches the SQL CHECK: source IN ('ai_generated', 'coach_assigned', 'imported').
// No DEFAULT in SQL by design -- callers must specify.
export const PlanSourceSchema = z.enum([
  "ai_generated",
  "coach_assigned",
  "imported",
]);
export type PlanSource = z.infer<typeof PlanSourceSchema>;

// event_date is SQL DATE (no time component). PostgREST returns it as
// "YYYY-MM-DD" string. Zod validates the string shape; format-precision
// validation belongs at the API boundary if stricter checks are wanted.
//
// Timestamps use .datetime({ offset: true }) because PostgREST returns
// TIMESTAMPTZ values in offset notation (e.g. "2026-05-13T10:30:00+00:00").
// The default .datetime() requires the strict Z suffix and would reject
// real Supabase output. Convention locked across packages/shared.
export const PlanRowSchema = z.object({
  id: z.string().uuid(),
  athlete_id: z.string().uuid(),
  status: PlanStatusSchema,
  event_type: z.string().nullable(),
  event_date: z.string().nullable(),
  source: PlanSourceSchema,
  // No FK yet (Unit 7 adds it); validates UUID format only.
  created_from_review_id: z.string().uuid().nullable(),
  created_at: z.string().datetime({ offset: true }),
  archived_at: z.string().datetime({ offset: true }).nullable(),
  deleted_at: z.string().datetime({ offset: true }).nullable(),
});

export type PlanRow = z.infer<typeof PlanRowSchema>;
