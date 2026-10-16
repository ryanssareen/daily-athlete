import { z } from "zod";

import { VerdictSchema } from "./workout-report";

// Wire contract for the Plan tab's story, week outline, results and forecast.
// Built server-side by apps/web (buildPlanView) and read by both the web page
// and the Flutter app (GET /api/plans/[id]/view). Hand-ported to Dart in
// daily-athlete/lib/models/plan_view.dart; packages/shared/test-fixtures/
// plan-view-sample.json is parsed by both test suites.

const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const PLAN_STORY_PARAGRAPH_MAX_LENGTH = 600;
export const PLAN_STORY_MAX_PARAGRAPHS = 3;
export const PLAN_VIEW_QUOTE_MAX_LENGTH = 300;
export const PLAN_VIEW_FOCUS_MAX_LENGTH = 200;
export const PLAN_VIEW_RATIONALE_MAX_LENGTH = 600;
export const PLAN_VIEW_INTENSITY_MAX_LENGTH = 80;

export const PlanPhaseSchema = z.enum(["build", "recovery", "peak", "taper"]);
export type PlanPhase = z.infer<typeof PlanPhaseSchema>;

export const PlanViewSessionStatusSchema = z.enum(["planned", "moved", "completed"]);
export type PlanViewSessionStatus = z.infer<typeof PlanViewSessionStatusSchema>;

export const PlanViewSessionSchema = z
  .object({
    id: z.string().min(1),
    date: DateOnlySchema,
    sport: z.string().min(1).max(40),
    plannedSeconds: z.number().finite().nonnegative().nullable(),
    plannedLoad: z.number().finite().nonnegative().nullable(),
    intensity: z.string().max(PLAN_VIEW_INTENSITY_MAX_LENGTH).nullable(),
    rationale: z.string().max(PLAN_VIEW_RATIONALE_MAX_LENGTH).nullable(),
    status: PlanViewSessionStatusSchema,
    verdict: VerdictSchema.nullable(),
  })
  .strict();
export type PlanViewSession = z.infer<typeof PlanViewSessionSchema>;

export const PlanViewWeekSchema = z
  .object({
    start: DateOnlySchema,
    phase: PlanPhaseSchema.nullable(),
    focus: z.string().max(PLAN_VIEW_FOCUS_MAX_LENGTH),
    plannedSeconds: z.number().finite().nonnegative(),
    executedSeconds: z.number().finite().nonnegative(),
    dueSeconds: z.number().finite().nonnegative(),
    // executed / due; null until something is due. May exceed 1.
    compliance: z.number().finite().nonnegative().nullable(),
    skippedCount: z.number().int().nonnegative(),
    current: z.boolean(),
    sessions: z.array(PlanViewSessionSchema),
  })
  .strict();
export type PlanViewWeek = z.infer<typeof PlanViewWeekSchema>;

export const PlanViewForecastSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ok"),
      endOfBlockDate: DateOnlySchema,
      ctl: z.number().finite(),
      atl: z.number().finite(),
      tsb: z.number().finite(),
      formVerdict: z.string().min(1).max(PLAN_VIEW_QUOTE_MAX_LENGTH),
      eventDay: z
        .object({
          date: DateOnlySchema,
          tsb: z.number().finite(),
          formVerdict: z.string().min(1).max(PLAN_VIEW_QUOTE_MAX_LENGTH),
        })
        .strict()
        .nullable(),
    })
    .strict(),
  z.object({ status: z.literal("unavailable-no-data") }).strict(),
  z.object({ status: z.literal("unavailable-complete") }).strict(),
]);
export type PlanViewForecast = z.infer<typeof PlanViewForecastSchema>;

export const PlanViewSectionErrorSchema = z.enum(["verdicts", "forecast"]);
export type PlanViewSectionError = z.infer<typeof PlanViewSectionErrorSchema>;

export const PlanViewSchema = z
  .object({
    planId: z.string().min(1),
    story: z
      .object({
        paragraphs: z
          .array(z.string().min(1).max(PLAN_STORY_PARAGRAPH_MAX_LENGTH))
          .min(1)
          .max(PLAN_STORY_MAX_PARAGRAPHS),
        whyQuote: z.string().min(1).max(PLAN_VIEW_QUOTE_MAX_LENGTH).nullable(),
      })
      .strict(),
    weeks: z.array(PlanViewWeekSchema),
    forecast: PlanViewForecastSchema,
    sectionErrors: z.array(PlanViewSectionErrorSchema),
  })
  .strict();
export type PlanView = z.infer<typeof PlanViewSchema>;
