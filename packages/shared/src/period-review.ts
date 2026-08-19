// Contracts for the weekly / monthly period review
// (docs/plans/2026-08-19-001-feat-period-reviews-and-email-plan.md, U2).
//
// NOT weekly_reviews. See the header of supabase/migrations/0029 for the full
// distinction; the one-line version is that `weekly_reviews` is an adaptive
// PROPOSAL the athlete decides on, and a period review is a RETROSPECTIVE they
// read.
//
// KTD2: the facts here are ARITHMETIC. A pure aggregation function
// (apps/web/src/ai/period-reviews/aggregate.ts, U3) produces a PeriodFacts
// from the athlete's completed and planned rows; only the prose
// (PeriodNarrationSchema) comes from an LLM, and it is handed the already-
// computed facts rather than raw workouts. The model explains the numbers, it
// does not author them. This is deliberately the opposite of the
// model-emits-the-report-structure approach in the WORKOUT-SITE reference
// codebase -- if the model authored the stat cards, every displayed number
// would be model output.
//
// KTD3: the facts are recomputed on every read and never persisted, so they
// cannot go stale. Only the narrative is cached, and only the narrative can be
// marked stale.
//
// Degradation, following the same structural discipline as
// workout-report.ts's KTD8 handling: a metric whose prescribed or actual side
// is missing degrades to `{status: "unavailable"}` INDEPENDENTLY rather than
// failing the whole period, and the "unavailable" branch structurally carries
// no other fields so a caller cannot read a phantom number off it.

import { z } from "zod";

import { SportSchema } from "./planned-workout";

// ---------------------------------------------------------------------------
// Period identity
// ---------------------------------------------------------------------------

// Matches the SQL CHECK on period_reviews.kind / period_review_deliveries.kind
// (0029). A second statement of that list -- extend BOTH in the same PR.
export const PeriodKindSchema = z.enum(["weekly", "monthly"]);
export type PeriodKind = z.infer<typeof PeriodKindSchema>;

// A period's IDENTITY (KTD4). ISO week (`2026-W33`) for weekly, year-month
// (`2026-08`) for monthly.
//
// The key, not a timestamp range, is the identity: the range depends on the
// athlete's timezone (which can change), while "week 33 of 2026" does not.
//
// Format is validated STRICTLY and PER KIND. A malformed or wrong-kind key is
// a validation failure, never a lookup that quietly misses -- the difference
// between "you have no review for that week" and "you asked for a week using
// a month's format" matters to every caller, and only a strict parse can tell
// them apart. The SQL CHECK in 0029 is a coarse structural backstop; this is
// the real parser.
const ISO_WEEK_KEY = /^(\d{4})-W(\d{2})$/;
const YEAR_MONTH_KEY = /^(\d{4})-(\d{2})$/;

/** True when `key` is a well-formed key for `kind`, INCLUDING range checks
 * (week 00 / 54 and month 00 / 13 are rejected, not merely shape-matched). */
export function isValidPeriodKey(kind: PeriodKind, key: string): boolean {
  if (kind === "weekly") {
    const m = ISO_WEEK_KEY.exec(key);
    if (!m) return false;
    const week = Number(m[2]);
    // ISO 8601 allows weeks 01-53; 53 exists only in long years, which is a
    // calendar question the calendar module answers, not a format question.
    return week >= 1 && week <= 53;
  }
  const m = YEAR_MONTH_KEY.exec(key);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}

/** Shape-only key schema. Prefer `PeriodIdentitySchema` below, which validates
 * the key AGAINST its kind -- a bare key string cannot be checked properly
 * because `2026-08` is a valid month and an invalid week. */
export const PeriodKeySchema = z
  .string()
  .regex(/^\d{4}-(W\d{2}|\d{2})$/, "period key must be YYYY-Www or YYYY-MM");
export type PeriodKey = z.infer<typeof PeriodKeySchema>;

// The kind and key together -- the only form in which a period identity can be
// fully validated. Every route, job payload, and response that names a period
// should carry this pair rather than a loose key.
export const PeriodIdentitySchema = z
  .object({
    kind: PeriodKindSchema,
    key: PeriodKeySchema,
  })
  .strict()
  .refine((v) => isValidPeriodKey(v.kind, v.key), {
    message: "period key format does not match the period kind",
    path: ["key"],
  });
export type PeriodIdentity = z.infer<typeof PeriodIdentitySchema>;

// Resolved local boundaries. `start`/`end` are local calendar DATES
// ("YYYY-MM-DD"), and `end` is INCLUSIVE -- the last local day of the period,
// matching how a human reads "the week of the 10th through the 16th" and
// matching the DATE columns in 0029.
export const PeriodBoundsSchema = z
  .object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict()
  .refine((v) => v.end >= v.start, {
    message: "period end must not precede period start",
    path: ["end"],
  });
export type PeriodBounds = z.infer<typeof PeriodBoundsSchema>;

// ---------------------------------------------------------------------------
// Deterministic facts
// ---------------------------------------------------------------------------

// A prescribed-vs-actual comparison for one aggregate metric over the period
// (total duration, total load).
//
// Discriminated union rather than one object with optional fields, for the
// same structural reason as workout-report.ts's DimensionDeltaSchema: an
// "unavailable" metric must parse with prescribed/actual/deltaPct all ABSENT,
// not merely undefined-typed-but-permitted. `.strict()` on the unavailable
// branch makes that guarantee structural.
//
// `.finite()` everywhere is load-bearing, not decoration: an empty period
// (AE2) divides by a zero prescription in the naive formulation, and pinning
// finiteness here makes "the engine never emits NaN/Infinity" a
// schema-enforced guarantee for every consumer rather than a convention U3 has
// to remember.
//
// The status vocabulary intentionally matches DimensionStatusSchema in
// workout-report.ts: `on_target` / `under` / `over` / `unavailable` already
// mean exactly this for a single session, and giving a period metric a
// different vocabulary for the same idea would make every renderer branch
// twice. The literals are restated inline here because the discriminated
// union needs `z.literal` members, not an enum reference.
export const PeriodMetricSchema = z.discriminatedUnion("status", [
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
export type PeriodMetric = z.infer<typeof PeriodMetricSchema>;

// NOTE: `DimensionStatusSchema` is deliberately NOT re-exported here. The
// barrel in index.ts uses `export *`, and a name exported from two modules is
// ambiguous under it -- workout-report.ts owns that export. Consumers import
// it from the barrel as usual; it is the same symbol either way.

// Plan compliance over the period: how many prescribed sessions were actually
// executed. `completed` can exceed `prescribed` (an athlete who added
// sessions), so this is not a bounded ratio and consumers must not assume one.
export const PeriodComplianceSchema = z
  .object({
    prescribed: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    // Unplanned sessions -- completed workouts with no match to a prescribed
    // one. Surfaced separately rather than folded into `completed`, because
    // "did 5 of 6 prescribed plus 2 extra" and "did 7 of 6" are different
    // training weeks and the narration must not conflate them.
    unplanned: z.number().int().nonnegative(),
  })
  .strict();
export type PeriodCompliance = z.infer<typeof PeriodComplianceSchema>;

// Per-sport rollup. One entry per sport the athlete actually touched in the
// period -- absent sports are OMITTED rather than zero-filled, so a runner's
// review does not render five empty rows.
export const PeriodSportRollupSchema = z
  .object({
    sport: SportSchema,
    sessions: z.number().int().nonnegative(),
    durationS: z.number().finite().nonnegative(),
    // Null, not zero: a swim with no distance recorded has UNKNOWN distance,
    // and rendering that as 0.0 km is a lie the athlete can read off a screen.
    distanceM: z.number().finite().nonnegative().nullable(),
    load: z.number().finite().nonnegative(),
  })
  .strict();
export type PeriodSportRollup = z.infer<typeof PeriodSportRollupSchema>;

// Raw period totals, before any comparison.
export const PeriodTotalsSchema = z
  .object({
    sessions: z.number().int().nonnegative(),
    durationS: z.number().finite().nonnegative(),
    distanceM: z.number().finite().nonnegative().nullable(),
    load: z.number().finite().nonnegative(),
    // Distinct local days on which the athlete trained. A more honest
    // consistency signal than session count for anyone who doubles up.
    activeDays: z.number().int().nonnegative(),
    // How the period's load was derived. "power" when every contributing
    // session had real power/HR data; "duration" when any of it fell back to
    // the duration proxy; "mixed" for a blend. The narration uses this to
    // hedge -- asserting a proxy TSS as a measured figure is exactly the kind
    // of false precision that makes an athlete stop trusting the report.
    loadConfidence: z.enum(["power", "duration", "mixed", "none"]),
  })
  .strict();
export type PeriodTotals = z.infer<typeof PeriodTotalsSchema>;

// Period-over-period change. Discriminated on `available` rather than being a
// nullable object with zeroed fields: "you did 20% less than last month" and
// "there is no last month to compare with" are completely different
// statements, and a zero-filled comparison silently renders the second as the
// first. AE-relevant: a brand-new athlete's first-ever week must not read as a
// 100% decline.
export const PeriodComparisonSchema = z.discriminatedUnion("available", [
  z
    .object({
      available: z.literal(true),
      previousKey: PeriodKeySchema,
      sessionsDeltaPct: z.number().finite(),
      durationDeltaPct: z.number().finite(),
      loadDeltaPct: z.number().finite(),
      activeDaysDelta: z.number().int(),
    })
    .strict(),
  z.object({ available: z.literal(false) }).strict(),
]);
export type PeriodComparison = z.infer<typeof PeriodComparisonSchema>;

// The complete deterministic fact set for one period. Recomputed on every read
// (KTD2); never persisted.
export const PeriodFactsSchema = z
  .object({
    kind: PeriodKindSchema,
    periodKey: PeriodKeySchema,
    bounds: PeriodBoundsSchema,
    totals: PeriodTotalsSchema,
    compliance: PeriodComplianceSchema,
    duration: PeriodMetricSchema,
    load: PeriodMetricSchema,
    sports: z.array(PeriodSportRollupSchema),
    comparison: PeriodComparisonSchema,
  })
  .strict();
export type PeriodFacts = z.infer<typeof PeriodFactsSchema>;

// ---------------------------------------------------------------------------
// Narration (the LLM's output contract -- the trust boundary)
// ---------------------------------------------------------------------------

// `.strict()` -- unlike an internal producer's evolving payload, this is
// untrusted model output. An unexpected key (a model-invented `confidence`,
// `sources`, or a recomputed stat) must be rejected at the boundary, not
// silently persisted and rendered.
//
// Caps are larger than the per-workout note's (REPORT_NOTE_MAX_LENGTH = 1000):
// a period retrospective legitimately covers more ground than a single
// session's debrief. They are still caps, and the narrate() output budget is
// sized against them (KTD9) rather than against the adapter default.
export const PERIOD_NOTE_MAX_LENGTH = 1800;
export const PERIOD_TAKEAWAY_MAX_LENGTH = 400;

export const PeriodNarrationSchema = z
  .object({
    note: z.string().min(1).max(PERIOD_NOTE_MAX_LENGTH),
    takeaway: z.string().min(1).max(PERIOD_TAKEAWAY_MAX_LENGTH),
  })
  .strict();
export type PeriodNarration = z.infer<typeof PeriodNarrationSchema>;

// ---------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------

// What GET/POST /api/reviews/:kind/:periodKey return.
//
// Deliberately shaped to mirror WorkoutReportResponse so the two report
// surfaces share one mental model:
//
// `narration` is null when nothing has been generated yet, or when generation
// was attempted and the LLM was rate-limited / transient-failed / returned
// invalid output. The facts are always present regardless (R15) -- a degraded
// narration never blanks a page that has good deterministic content.
//
// `stale`: the stored narrative's fingerprint no longer matches the freshly
// computed inputs (KTD3) -- something material changed since the prose was
// written. Always false when `narration` is null: staleness describes a stored
// narrative, not the absence of one.
//
// `generatable`: the athlete may POST for this period right now -- true both
// for "never generated" and for "stale, eligible to regenerate".
//
// `retryable`: present ONLY on a POST that attempted generation and failed.
// true -> the LLM backed off (rate limit / transient), asking again may work;
// false -> the model produced unusable output, asking again is unlikely to
// help. Its presence IS the signal that an attempt happened and produced no
// prose. The response stays 200 in both cases (AE9).
export const PeriodReviewResponseSchema = z
  .object({
    facts: PeriodFactsSchema,
    narration: PeriodNarrationSchema.nullable(),
    generatedAt: z.string().datetime({ offset: true }).nullable(),
    stale: z.boolean(),
    generatable: z.boolean(),
    retryable: z.boolean().optional(),
  })
  .strict();
export type PeriodReviewResponse = z.infer<typeof PeriodReviewResponseSchema>;

// One row of the "my reviews" listing. Carries just enough for a list item --
// a headline stat and whether prose already exists -- so the surface can
// render N periods without N round trips.
export const PeriodReviewSummarySchema = z
  .object({
    kind: PeriodKindSchema,
    periodKey: PeriodKeySchema,
    bounds: PeriodBoundsSchema,
    sessions: z.number().int().nonnegative(),
    durationS: z.number().finite().nonnegative(),
    load: z.number().finite().nonnegative(),
    hasNarration: z.boolean(),
  })
  .strict();
export type PeriodReviewSummary = z.infer<typeof PeriodReviewSummarySchema>;

export const PeriodReviewListResponseSchema = z
  .object({ periods: z.array(PeriodReviewSummarySchema) })
  .strict();
export type PeriodReviewListResponse = z.infer<typeof PeriodReviewListResponseSchema>;

// ---------------------------------------------------------------------------
// Email preferences
// ---------------------------------------------------------------------------

// Mirrors the users.email_{weekly,monthly}_review columns (0030). Two
// independent booleans, not one enum: an athlete who wants the monthly
// retrospective but finds a weekly email noisy is a real case a single flag
// cannot express.
export const EmailPreferencesSchema = z
  .object({
    weeklyReview: z.boolean(),
    monthlyReview: z.boolean(),
  })
  .strict();
export type EmailPreferences = z.infer<typeof EmailPreferencesSchema>;

// PATCH body: either field may be omitted to leave it untouched. `.strict()`
// rejects an unknown key rather than ignoring it, so a client typo fails
// loudly instead of silently not saving.
export const EmailPreferencesUpdateSchema = z
  .object({
    weeklyReview: z.boolean().optional(),
    monthlyReview: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.weeklyReview !== undefined || v.monthlyReview !== undefined, {
    message: "at least one preference must be provided",
  });
export type EmailPreferencesUpdate = z.infer<typeof EmailPreferencesUpdateSchema>;

// Which cadence an unsubscribe link switches off. Same vocabulary as
// PeriodKindSchema by construction -- an unsubscribe is always FROM a cadence
// of period review -- and aliased rather than redeclared so the two cannot
// drift apart.
export const UnsubscribeCadenceSchema = PeriodKindSchema;
export type UnsubscribeCadence = PeriodKind;
