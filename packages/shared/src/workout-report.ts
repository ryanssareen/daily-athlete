// Contracts for the per-workout report feature (docs/plans/2026-08-18-001-feat-workout-reports-plan.md).
// The verdict and the execution comparison are ARITHMETIC (KTD1): a pure,
// deterministic function (apps/web/src/ai/reports/delta.ts, Unit U3) produces
// an ExecutionDelta from prescribed-vs-actual numbers. Only the prose
// (ReportNarrationSchema) comes from an LLM, and it is handed the already-
// computed delta rather than raw payloads -- it explains the verdict, it does
// not compute one.
//
// KTD2: the delta is computed on read and never persisted, so it has no
// staleness problem. Only the narrative (workout_reports.narrative/takeaway,
// Unit U1) is cached, and only the narrative can go `stale`.
//
// KTD8: PlannedWorkoutStructureSchema is `.passthrough()` with only `phase`
// guaranteed, so a coach-authored or hand-edited planned workout may be
// missing `duration_s`, `load`, or `intensity_target`. Every delta dimension
// therefore degrades INDEPENDENTLY to `{status: "unavailable"}` rather than
// failing the whole report -- this is enforced structurally below (the
// "unavailable" branch of each dimension schema carries no other fields), not
// left to caller discipline.

import { z } from "zod";

import { IntensityTargetSchema } from "./edit-op";

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

// Closed vocabulary (NOT a passthrough string) -- the verdict is computed by
// our own code from the dimension statuses below, so there is no untrusted
// producer that could hand us an unrecognized code. A closed enum makes an
// unrecognized code a validation failure instead of a silent new UI state.
export const VerdictCodeSchema = z.enum([
  "executed_as_prescribed",
  "under_executed",
  "over_executed",
  "partial_data",
  "unplanned_effort",
]);
export type VerdictCode = z.infer<typeof VerdictCodeSchema>;

// Defensive cap on the templated (not LLM-authored) headline string. This is
// NOT the untrusted-string trust boundary -- see ReportNarrationSchema below
// for that -- it just keeps a programming error (e.g. an interpolated array)
// from producing an unbounded string.
export const REPORT_HEADLINE_MAX_LENGTH = 200;

// The headline is templated from `code` + the computed numbers by our own
// code (see the plan's High-Level Technical Design), never model-written.
export const VerdictSchema = z
  .object({
    code: VerdictCodeSchema,
    headline: z.string().min(1).max(REPORT_HEADLINE_MAX_LENGTH),
  })
  .strict();
export type Verdict = z.infer<typeof VerdictSchema>;

// ---------------------------------------------------------------------------
// Per-dimension delta
// ---------------------------------------------------------------------------

// `on_target` / `under` / `over` = the dimension was resolvable and compared;
// `unavailable` = one side of the comparison did not exist (KTD8). Kept as a
// standalone export because callers (e.g. the web ComparisonRows renderer)
// switch on it independently of which concrete dimension schema is in play.
export const DimensionStatusSchema = z.enum(["on_target", "under", "over", "unavailable"]);
export type DimensionStatus = z.infer<typeof DimensionStatusSchema>;

// `prescribed`/`actual`/`deltaPct` are `.finite()`, not just `z.number()`:
// the delta engine (Unit U3) is required to avoid Infinity/NaN from
// zero-duration or zero-load prescriptions, and pinning `.finite()` here
// makes that a schema-enforced guarantee for every consumer, not just a
// convention the engine has to remember.
//
// Used for `duration` and `load`, whose prescribed/actual values are plain
// scalars in an unambiguous unit (seconds, TSS). See
// `IntensityDimensionDeltaSchema` below for `intensity`, whose prescribed
// value additionally carries the tagged-union target so the UI/narration can
// label it (75% FTP vs Zone 3 vs a pace).
//
// This is a discriminated union, not one object with optional fields: KTD8
// requires that an "unavailable" dimension parse with prescribed/actual/
// deltaPct all ABSENT, not merely `undefined`-typed-but-permitted. The
// discriminated union makes the "unavailable" branch reject those keys
// outright (`.strict()`), so the guarantee is structural.
export const DimensionDeltaSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("on_target"),
      prescribed: z.number().finite(),
      actual: z.number().finite(),
      deltaPct: z.number().finite(),
    })
    .strict(),
  z
    .object({
      status: z.literal("under"),
      prescribed: z.number().finite(),
      actual: z.number().finite(),
      deltaPct: z.number().finite(),
    })
    .strict(),
  z
    .object({
      status: z.literal("over"),
      prescribed: z.number().finite(),
      actual: z.number().finite(),
      deltaPct: z.number().finite(),
    })
    .strict(),
  z.object({ status: z.literal("unavailable") }).strict(),
]);
export type DimensionDelta = z.infer<typeof DimensionDeltaSchema>;

// Same shape and same KTD8 guarantee as DimensionDeltaSchema, but the
// resolvable branches additionally carry `target`, the original
// IntensityTargetSchema (imported from edit-op.ts, NOT redefined here --
// edit-op.ts froze this union's kinds/units for the whole adaptive-engine
// surface and the report reuses it verbatim). `prescribed`/`actual` alone
// (e.g. "82") are meaningless without knowing whether they are %FTP, a
// 1-7 zone, or seconds-per-km; `target` disambiguates for the UI and for the
// narration fact sheet.
export const IntensityDimensionDeltaSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("on_target"),
      target: IntensityTargetSchema,
      prescribed: z.number().finite(),
      actual: z.number().finite(),
      deltaPct: z.number().finite(),
    })
    .strict(),
  z
    .object({
      status: z.literal("under"),
      target: IntensityTargetSchema,
      prescribed: z.number().finite(),
      actual: z.number().finite(),
      deltaPct: z.number().finite(),
    })
    .strict(),
  z
    .object({
      status: z.literal("over"),
      target: IntensityTargetSchema,
      prescribed: z.number().finite(),
      actual: z.number().finite(),
      deltaPct: z.number().finite(),
    })
    .strict(),
  z.object({ status: z.literal("unavailable") }).strict(),
]);
export type IntensityDimensionDelta = z.infer<typeof IntensityDimensionDeltaSchema>;

const ExecutionDeltaDimensionsSchema = z
  .object({
    duration: DimensionDeltaSchema,
    load: DimensionDeltaSchema,
    intensity: IntensityDimensionDeltaSchema,
  })
  .strict();
export type ExecutionDeltaDimensions = z.infer<typeof ExecutionDeltaDimensionsSchema>;

// ---------------------------------------------------------------------------
// Execution delta (the verdict-bearing comparison)
// ---------------------------------------------------------------------------

// Discriminated on `matched`, not `dimensions: X | undefined`, for the same
// structural reason as DimensionDeltaSchema above: an unmatched workout
// (R4/AE3 -- unplanned effort, no `workout_matches` row) must parse with NO
// `dimensions` key at all, not an empty/absent-valued one. `verdict` is
// present on both branches -- an unmatched workout still gets a verdict
// (`unplanned_effort`), it just never reaches the comparison branch that
// would populate `dimensions`.
export const ExecutionDeltaSchema = z.discriminatedUnion("matched", [
  z
    .object({
      matched: z.literal(true),
      dimensions: ExecutionDeltaDimensionsSchema,
      verdict: VerdictSchema,
    })
    .strict(),
  z
    .object({
      matched: z.literal(false),
      verdict: VerdictSchema,
    })
    .strict(),
]);
export type ExecutionDelta = z.infer<typeof ExecutionDeltaSchema>;

// ---------------------------------------------------------------------------
// Narration (the LLM's output contract -- the trust boundary)
// ---------------------------------------------------------------------------

// `src/llm`'s generateStructured returns `unknown` by contract (see
// apps/web/src/ai/adaptive/llm-proposer.ts for the established pattern); the
// caller (Unit U5's narrate()) safeParses the model's JSON against this
// schema before it touches a database row or a UI. `.strict()` -- unlike
// SummaryStatsSchema's deliberate `.passthrough()` -- because this is
// untrusted model output, not an internal producer's evolving payload: an
// unexpected key (e.g. a model-invented `confidence` or `sources` field)
// must be rejected at the boundary, not silently persisted or rendered.
//
// Length caps follow the weekly_reviews.narrative convention
// (NARRATIVE_MAX_LENGTH in edit-op.ts) but are tighter, matching R5's much
// smaller shape: a 3-6 sentence note plus a single forward-looking sentence,
// not a multi-edit weekly summary.
export const REPORT_NOTE_MAX_LENGTH = 1000;
export const REPORT_TAKEAWAY_MAX_LENGTH = 300;

export const ReportNarrationSchema = z
  .object({
    note: z.string().min(1).max(REPORT_NOTE_MAX_LENGTH),
    takeaway: z.string().min(1).max(REPORT_TAKEAWAY_MAX_LENGTH),
  })
  .strict();
export type ReportNarration = z.infer<typeof ReportNarrationSchema>;

// ---------------------------------------------------------------------------
// API response
// ---------------------------------------------------------------------------

// What GET/POST /api/workouts/:id/report (Unit U6) return. `delta` carries
// its own `verdict` (see ExecutionDeltaSchema above), so this response
// exposes the verdict by exposing the delta -- there is no separate
// top-level `verdict` field to keep in sync with `delta.verdict`.
//
// `narration` is null whenever no narrative has been generated yet, or (per
// KTD1/AE6) whenever generation was attempted but the LLM was rate-limited,
// transient-failed, or returned invalid output -- the route always has a
// verdict and a delta to show even when narration is null (R13).
//
// `stale`: true when a stored narrative's fingerprint no longer matches the
// freshly-computed context (Unit U4/KTD4) -- material inputs changed since
// the narrative was written (R9). Always false when `narration` is null:
// staleness describes a stored narrative, not the absence of one.
//
// `generatable`: true when the athlete may request generation (POST) for
// this workout right now -- true both for "never generated" and "stale,
// eligible to regenerate".
// `retryable`: present ONLY on a POST that attempted generation and failed.
// true  -> the LLM backed off (rate limit / transient); asking again may work.
// false -> the model produced unusable output; asking again is unlikely to help.
// Absent on every GET and on a successful POST -- its presence is the signal
// that a generation attempt happened and did not produce a narration. The
// response stays 200 in both cases because the delta and verdict are still
// valid (KTD2); a 5xx would blank a page that has good deterministic content.
//
// `verdictChanged`: a STRICTLY STRONGER form of `stale`. True when the stored
// narrative was written against a different VerdictCode than the one the
// freshly-computed delta carries -- i.e. the workout no longer merely has
// different numbers, it now falls in a different judgment category (e.g. a
// note explaining "under-executed" sitting under an "As prescribed" header).
// `stale` alone is not enough to drive that UI decision: a stale note whose
// verdict category is unchanged is still broadly true and worth showing
// behind an "out of date" badge, whereas a category flip makes the note
// actively contradict the verdict above it, so the renderer must suppress
// the prose rather than badge it. Implies `stale`; never true when
// `narration` is null (there is no prose to contradict anything).
export const WorkoutReportResponseSchema = z
  .object({
    delta: ExecutionDeltaSchema,
    narration: ReportNarrationSchema.nullable(),
    stale: z.boolean(),
    generatable: z.boolean(),
    retryable: z.boolean().optional(),
    verdictChanged: z.boolean().optional(),
  })
  .strict();
export type WorkoutReportResponse = z.infer<typeof WorkoutReportResponseSchema>;
