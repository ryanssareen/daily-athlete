// Contracts for the AI plan-generation pipeline (category A / product Unit 3.2).
// Shared by the generator (apps/web/src/ai/generation) and the eval harness
// (apps/web/evals). The exact LLM JSON wording is deferred to implementation;
// what is FROZEN here is the shape + value-domains both sides depend on.
//
// The generated workout `structure` is a STRICT SUPERSET of edit-op.ts's
// StructureChangeSchema with IDENTICAL units (duration_s seconds, load TSS,
// intensity_target tagged union) — so the adaptive engine can keep adapting AI
// rows at the workout level. `.strict()` everywhere the LLM emits content so an
// injected/unexpected key (esp. unbounded free-text) is rejected at the write
// boundary, not silently persisted.

import { z } from "zod";

import { IntensityTargetSchema, NARRATIVE_MAX_LENGTH, REASON_MAX_LENGTH } from "./edit-op";
import { SportSchema, WorkoutPhaseSchema } from "./planned-workout";

// YYYY-MM-DD calendar date (matches planned_workouts.scheduled_date).
const DateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

// Free-text caps (untrusted: athlete-supplied or LLM-authored).
export const INJURY_HISTORY_MAX_LENGTH = 2000;
export const WORKOUT_DESCRIPTION_MAX_LENGTH = 1000;
export const EVENT_TYPE_MAX_LENGTH = 100;

// ---------------------------------------------------------------------------
// Generation request (R5)
// ---------------------------------------------------------------------------

// standard = full periodization; time_crunched (A6) = adaptation-per-hour bias.
export const GeneratePlanModeSchema = z.enum(["standard", "time_crunched"]);
export type GeneratePlanMode = z.infer<typeof GeneratePlanModeSchema>;

// The body the athlete (or their coach) submits. `athlete_id` is in the body so
// the route can resolve owner-vs-linked-coach before the entitlement check.
// NOTE: "event_date must be in the future" is a business rule enforced at the
// route / feasibility check (which knows today's date), NOT in this schema —
// keeping the schema pure/deterministic.
export const GeneratePlanInputSchema = z
  .object({
    athlete_id: z.string().uuid(),
    event_type: z.string().max(EVENT_TYPE_MAX_LENGTH).nullable().default(null),
    event_date: DateStringSchema.nullable().default(null),
    weekly_hours: z.number().positive().max(40),
    // Untrusted free text — capped; delimited as data (never instructions) in
    // the prompt; output gated by the runtime content-gate (Unit 4).
    injury_history: z.string().max(INJURY_HISTORY_MAX_LENGTH).default(""),
    mode: GeneratePlanModeSchema.default("standard"),
    // Optional fitness inputs (auto-prefilled from the athlete profile).
    ftp_watts: z.number().positive().optional(),
    threshold_pace_s_per_km: z.number().positive().optional(),
  })
  .strict();
export type GeneratePlanInput = z.infer<typeof GeneratePlanInputSchema>;

// Pure "is the event in the future?" check. The schema can't know today's date
// (and must stay deterministic), so the route/feasibility passes today in. Both
// args are YYYY-MM-DD, which sort lexicographically the same as chronologically.
export function isFutureEventDate(eventDate: string, today: string): boolean {
  return eventDate > today;
}

// ---------------------------------------------------------------------------
// Step 1 — periodization skeleton (blocks + weekly TSS targets)
// ---------------------------------------------------------------------------

export const PlanBlockSchema = z
  .object({
    phase: WorkoutPhaseSchema,
    start_date: DateStringSchema,
    end_date: DateStringSchema,
    weekly_tss_target: z.number().nonnegative(),
  })
  .strict();
export type PlanBlock = z.infer<typeof PlanBlockSchema>;

export const PlanSkeletonSchema = z
  .object({
    blocks: z.array(PlanBlockSchema).min(1),
  })
  .strict();
export type PlanSkeleton = z.infer<typeof PlanSkeletonSchema>;

// ---------------------------------------------------------------------------
// Step 2 — week shapes
// ---------------------------------------------------------------------------

export const WeekShapeSchema = z
  .object({
    week_start: DateStringSchema,
    phase: WorkoutPhaseSchema,
    target_tss: z.number().nonnegative(),
    // Light per-session intent; full detail is filled in step 3.
    sessions: z
      .array(
        z
          .object({
            sport: SportSchema,
            intensity_target: IntensityTargetSchema.optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();
export type WeekShape = z.infer<typeof WeekShapeSchema>;

// ---------------------------------------------------------------------------
// Step 3 — workout detail + the final calendar-ready plan
// ---------------------------------------------------------------------------

// STRICT superset of edit-op.ts StructureChangeSchema, with identical units.
// Required for a generated workout (every session has duration/load/intensity
// and a block phase); `description` is the only free-text field and it is
// length-capped. No passthrough -> no unbounded injected key survives.
export const GeneratedWorkoutStructureSchema = z
  .object({
    duration_s: z.number().int().positive(),
    load: z.number().nonnegative(),
    intensity_target: IntensityTargetSchema,
    phase: WorkoutPhaseSchema,
    description: z.string().max(WORKOUT_DESCRIPTION_MAX_LENGTH).optional(),
  })
  .strict();
export type GeneratedWorkoutStructure = z.infer<
  typeof GeneratedWorkoutStructureSchema
>;

export const GeneratedWorkoutSchema = z
  .object({
    scheduled_date: DateStringSchema,
    sport: SportSchema,
    structure: GeneratedWorkoutStructureSchema,
    // Per-workout rationale (R7). Untrusted LLM string — capped, plain-text.
    rationale: z.string().min(1).max(REASON_MAX_LENGTH),
    // TSS-equivalent; mirrors structure.load so the calendar/load layer can
    // read planned_load without unpacking structure.
    planned_load: z.number().nonnegative(),
  })
  .strict()
  // planned_load and structure.load are the SAME quantity stored twice (one for
  // the calendar/load layer, one inside structure). The safety validator forward-
  // simulates from planned_load while the adaptive engine re-seeds from
  // structure.load, so a model that diverges them could slip an unsafe load past
  // the gate that the engine later acts on. Reject the divergence at the trust
  // boundary; the generator's parse-retry loop feeds the mismatch back to the model.
  .superRefine((wk, ctx) => {
    if (Math.abs(wk.planned_load - wk.structure.load) > 1e-6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["planned_load"],
        message: `planned_load (${wk.planned_load}) must equal structure.load (${wk.structure.load})`,
      });
    }
  });
export type GeneratedWorkout = z.infer<typeof GeneratedWorkoutSchema>;

export const GeneratedPlanSchema = z
  .object({
    event_type: z.string().max(EVENT_TYPE_MAX_LENGTH).nullable(),
    event_date: DateStringSchema.nullable(),
    // Plan-level summary shown to the athlete. Untrusted — capped, plain-text.
    narrative: z.string().max(NARRATIVE_MAX_LENGTH).optional(),
    workouts: z.array(GeneratedWorkoutSchema).min(1),
  })
  .strict();
export type GeneratedPlan = z.infer<typeof GeneratedPlanSchema>;
