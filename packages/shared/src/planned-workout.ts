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

// Edit attribution kind. The SQL column is plain TEXT (no CHECK); Zod is the
// enforced contract at API boundaries. `agent` marks edits made through the MCP
// connector (the athlete acting via an external AI), distinct from in-app
// athlete/coach edits and the ai_review adaptive engine.
export const EditedByKindSchema = z.enum(["athlete", "coach", "ai_review", "agent"]);
export type EditedByKind = z.infer<typeof EditedByKindSchema>;

// Periodization phase (block) tag. Generation writes this per workout
// (structure.phase) so the plan is block-structured without a schema/table
// change. It is a generation-time hint that MAY drift after workout-level
// adaptation (the shipped EditOp engine has no block awareness) — downstream
// consumers treat it as a hint, not a guarantee, until block-replan (vNext).
export const WORKOUT_PHASES = [
  "base",
  "build",
  "peak",
  "taper",
  "maintenance",
] as const;
export const WorkoutPhaseSchema = z.enum(WORKOUT_PHASES);
export type WorkoutPhase = z.infer<typeof WorkoutPhaseSchema>;

// Per-workout structure size cap. Supabase Realtime has a ~10MB per-MESSAGE
// cap; a whole plan publishes many workouts, so each structure is bounded well
// under that. 16 KiB is generous for a single session's structure.
export const MAX_STRUCTURE_BYTES = 16_384;

// Structure JSONB as STORED/READ. Kept backward-compatible (passthrough) so
// existing coach/athlete-authored rows — which never followed a fixed shape —
// still parse: only an optional typed `phase` and a size refinement are added.
// The STRICT, enumerated, length-capped shape the AI is allowed to EMIT lives
// in packages/shared/src/plan-generation.ts (GeneratedWorkoutStructureSchema);
// that is the actual write boundary for AI content, so injected/unbounded
// free-text never reaches a persisted AI row even though this read schema stays
// permissive for legacy data.
export const PlannedWorkoutStructureSchema = z
  .object({
    phase: WorkoutPhaseSchema.optional(),
  })
  .passthrough()
  .superRefine((val, ctx) => {
    if (JSON.stringify(val).length > MAX_STRUCTURE_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `structure exceeds ${MAX_STRUCTURE_BYTES} bytes`,
      });
    }
  });
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
