// Mirror of public.planned_workouts from supabase/migrations/0007_plans_and_planned_workouts.sql.
// Per-day workout row. Optionally hangs off a plan (plan_id may be NULL for
// ad-hoc workouts -- R8). Calendar query path; the partial composite index
// planned_workouts_athlete_date covers it.
//
// Cross-table consistency note: planned_workouts.athlete_id is NOT
// SQL-enforced to match plans.athlete_id when plan_id is set. This is an
// app-layer invariant (see the migration comment). Tests in Unit 3
// document the surprising behavior.

import { z } from "zod";

// Matches the SQL CHECK: sport IN ('swim','bike','run','strength','mobility','other').
// 'other' is the escape hatch for unusual activities; the canonical
// vocabulary may grow but the CHECK keeps it tight for v1.
export const SportSchema = z.enum([
  "swim",
  "bike",
  "run",
  "strength",
  "mobility",
  "other",
]);
export type Sport = z.infer<typeof SportSchema>;

// Matches the SQL CHECK: status IN ('planned','completed','skipped','moved').
// SQL DEFAULT is 'planned'; that is enforced at INSERT time, not by Zod.
export const PlannedWorkoutStatusSchema = z.enum([
  "planned",
  "completed",
  "skipped",
  "moved",
]);
export type PlannedWorkoutStatus = z.infer<typeof PlannedWorkoutStatusSchema>;

// Edit attribution kind. Pinned in Zod at v1 to {athlete, coach, ai_review}
// even though the SQL column is plain TEXT with no CHECK constraint -- the
// SQL is intentionally open to support a future vocabulary expansion
// without a migration; Zod is the enforced contract at API boundaries.
// See the migration's comment block for the design rationale.
export const EditedByKindSchema = z.enum(["athlete", "coach", "ai_review"]);
export type EditedByKind = z.infer<typeof EditedByKindSchema>;

// Permissive structure JSONB. Final shape converges with the AI prompt in
// product plan Unit 3.2. Top-level keys reserved (warmup, main, cooldown,
// intervals, targets) but inner schema stays open (.passthrough). The eval
// harness (product plan Unit 3.1) will tighten this once the prompt
// stabilises.
//
// Size note: ce:review flagged that Supabase Realtime has a ~10MB
// per-message cap. Today there is no Zod .max() refinement; product plan
// Unit 3.2 should constrain output size in the prompt and add a refinement
// here once a representative max is known.
export const PlannedWorkoutStructureSchema = z.object({}).passthrough();
export type PlannedWorkoutStructure = z.infer<
  typeof PlannedWorkoutStructureSchema
>;

// Timestamps use .datetime({ offset: true }) -- convention locked across
// packages/shared (see plan.ts header).
export const PlannedWorkoutRowSchema = z.object({
  id: z.string().uuid(),
  athlete_id: z.string().uuid(),
  // Nullable for ad-hoc workouts.
  plan_id: z.string().uuid().nullable(),
  // SQL DATE; PostgREST returns "YYYY-MM-DD" string.
  scheduled_date: z.string(),
  sport: SportSchema,
  structure: PlannedWorkoutStructureSchema,
  // Units (TSS-equivalent / minutes / custom) deferred to product plan Unit 2.3.
  planned_load: z.number().nullable(),
  status: PlannedWorkoutStatusSchema,
  rationale: z.string().nullable(),
  edited_by_kind: EditedByKindSchema.nullable(),
  edited_by_user_id: z.string().uuid().nullable(),
  edited_at: z.string().datetime({ offset: true }).nullable(),
  // Monotonic row-version token (migration 0021). Bumped by a BEFORE UPDATE
  // trigger only when a plannable column changes. The AI adaptive engine's
  // per-op staleness baseline -- NOT edited_at (which is stamped inconsistently
  // across writers). Starts at 1.
  version: z.number().int(),
  created_at: z.string().datetime({ offset: true }),
  deleted_at: z.string().datetime({ offset: true }).nullable(),
});

export type PlannedWorkoutRow = z.infer<typeof PlannedWorkoutRowSchema>;
