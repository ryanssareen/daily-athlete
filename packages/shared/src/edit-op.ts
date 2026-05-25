// The edit-operation diff contract for the AI adaptive engine. The LLM emits a
// set of EditOps against an existing plan (NOT a regenerated plan); the
// deterministic validator (apps/web/src/training-load/invariants.ts) drops
// unsafe ops before the athlete/coach sees them, and the apply RPC (Unit 6)
// applies the accepted, non-stale survivors. See:
//   docs/plans/2026-05-25-001-feat-ai-adaptive-plans-engine-plan.md (Units 1, 5, 6)
//
// Design notes (from the plan's deepening reviews):
// - The `structure` subset the engine reads/writes is FROZEN here with pinned
//   UNITS and value-domains (not just field names): a name-only match with
//   differing units (seconds vs minutes, TSS vs kJ) would compute unsafe
//   decisions while tests stay green. This is the cross-plan contract with the
//   (not-yet-built) plan-generation pipeline (Unit 3.2): its real
//   planned_workouts.structure must be a SUPERSET of this subset.
// - `reason` is an untrusted LLM string → length-capped and rendered as plain
//   text (never HTML/markdown) by the UI.

import { z } from "zod";

import { PlannedWorkoutStatusSchema, SportSchema } from "./planned-workout";

// Length caps for untrusted LLM-authored strings.
export const REASON_MAX_LENGTH = 500;
export const NARRATIVE_MAX_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Frozen `structure` subset (units pinned)
// ---------------------------------------------------------------------------

// Intensity target as a tagged union so the value's meaning is unambiguous.
// `ftp_pct` = percent of FTP (e.g. 75 = 75% FTP); `zone` = 1..7 training zone;
// `pace_s_per_km` = target pace in seconds per kilometre.
export const IntensityTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ftp_pct"), value: z.number().positive() }),
  z.object({ kind: z.literal("zone"), value: z.number().int().min(1).max(7) }),
  z.object({ kind: z.literal("pace_s_per_km"), value: z.number().positive() }),
]);
export type IntensityTarget = z.infer<typeof IntensityTargetSchema>;

// The only `structure` fields the engine is allowed to read/modify. `.strict()`
// so an op carrying an unexpected key is rejected at the boundary rather than
// silently passed through to the plan.
export const StructureChangeSchema = z
  .object({
    // Whole-session duration in SECONDS (integer).
    duration_s: z.number().int().positive().optional(),
    // Planned training load in TSS-equivalent units (non-negative number).
    load: z.number().nonnegative().optional(),
    intensity_target: IntensityTargetSchema.optional(),
  })
  .strict();
export type StructureChange = z.infer<typeof StructureChangeSchema>;

// A YYYY-MM-DD calendar date string (matches planned_workouts.scheduled_date,
// which PostgREST returns as a "YYYY-MM-DD" string).
const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const reasonSchema = z.string().min(1).max(REASON_MAX_LENGTH);
// Stable per-op identifier so the UI can cherry-pick and the apply path can
// report per-op outcomes. Engine-assigned (not a DB id).
const opIdSchema = z.string().min(1);

// ---------------------------------------------------------------------------
// Edit operations (discriminated on `kind`)
// ---------------------------------------------------------------------------

export const EditOpKindSchema = z.enum(["move", "modify", "skip", "insert", "delete"]);
export type EditOpKind = z.infer<typeof EditOpKindSchema>;

export const EditOpSchema = z.discriminatedUnion("kind", [
  // Reschedule an existing workout to a different day.
  z.object({
    op_id: opIdSchema,
    kind: z.literal("move"),
    workout_id: z.string().uuid(),
    to_date: DateStringSchema,
    reason: reasonSchema,
  }),
  // Change an existing workout's plannable content.
  z.object({
    op_id: opIdSchema,
    kind: z.literal("modify"),
    workout_id: z.string().uuid(),
    changes: StructureChangeSchema,
    reason: reasonSchema,
  }),
  // Drop an existing workout (status -> skipped).
  z.object({
    op_id: opIdSchema,
    kind: z.literal("skip"),
    workout_id: z.string().uuid(),
    reason: reasonSchema,
  }),
  // Remove an existing workout (soft-delete at apply time).
  z.object({
    op_id: opIdSchema,
    kind: z.literal("delete"),
    workout_id: z.string().uuid(),
    reason: reasonSchema,
  }),
  // Add a new workout. No workout_id (nothing exists yet); the apply path
  // checks the target ISO-week's composition for staleness instead of a row
  // version.
  z.object({
    op_id: opIdSchema,
    kind: z.literal("insert"),
    on_date: DateStringSchema,
    sport: SportSchema,
    structure: StructureChangeSchema,
    reason: reasonSchema,
  }),
]);
export type EditOp = z.infer<typeof EditOpSchema>;

// ---------------------------------------------------------------------------
// Per-op staleness baseline + the persisted proposed-edit wrapper
// ---------------------------------------------------------------------------

// Snapshot of the target row at generation time. `version` (from
// planned_workouts.version) is the authoritative staleness token; `status` is
// kept for human-readable reporting only. NULL for `insert` ops (no row yet).
export const EditBaselineSchema = z.object({
  version: z.number().int().nonnegative(),
  status: PlannedWorkoutStatusSchema.optional(),
});
export type EditBaseline = z.infer<typeof EditBaselineSchema>;

// One entry in weekly_reviews.proposed_changes: the validated op plus its
// staleness baseline (null for insert).
export const ProposedEditSchema = z.object({
  op: EditOpSchema,
  baseline: EditBaselineSchema.nullable(),
});
export type ProposedEdit = z.infer<typeof ProposedEditSchema>;

// ---------------------------------------------------------------------------
// Apply-time per-op outcome (returned by the apply RPC / surfaced in the UI)
// ---------------------------------------------------------------------------

export const EditOpOutcomeSchema = z.enum([
  "applied",
  "skipped_stale", // version changed since generation
  "refused_completed", // target already completed/matched
  "dropped_invalid", // re-validation against current load dropped it
  "dropped_coach_protected", // target is a coach-edited row
]);
export type EditOpOutcome = z.infer<typeof EditOpOutcomeSchema>;

export const EditOpResultSchema = z.object({
  op_id: opIdSchema,
  outcome: EditOpOutcomeSchema,
  detail: z.string().max(REASON_MAX_LENGTH).optional(),
});
export type EditOpResult = z.infer<typeof EditOpResultSchema>;
