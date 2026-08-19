// Contract tests for period-review.ts (U2).
//
// The theme running through these: the schemas are the enforcement point for
// invariants the engine (U3) would otherwise have to remember. If a
// zero-division artifact, a wrong-kind period key, or a phantom field on an
// "unavailable" metric can parse here, it can reach a screen.

import { describe, expect, it } from "vitest";

import {
  EmailPreferencesUpdateSchema,
  isValidPeriodKey,
  PeriodBoundsSchema,
  PeriodComparisonSchema,
  PeriodFactsSchema,
  PeriodIdentitySchema,
  PeriodKindSchema,
  PeriodMetricSchema,
  PeriodNarrationSchema,
  PeriodReviewResponseSchema,
  PERIOD_NOTE_MAX_LENGTH,
  PERIOD_TAKEAWAY_MAX_LENGTH,
} from "../period-review";

// ---------------------------------------------------------------------------
// Period identity
// ---------------------------------------------------------------------------

describe("period key validation", () => {
  it.each(["2026-W01", "2026-W33", "2026-W53"])("accepts %s as a weekly key", (key) => {
    expect(isValidPeriodKey("weekly", key)).toBe(true);
  });

  it.each([
    ["2026-W54", "week beyond the ISO maximum"],
    ["2026-W00", "week zero"],
    ["2026-W3", "unpadded week"],
    ["2026-08", "a month key"],
    ["last-week", "free text"],
    ["", "empty"],
  ])("rejects %s as a weekly key (%s)", (key) => {
    expect(isValidPeriodKey("weekly", key)).toBe(false);
  });

  it.each(["2026-01", "2026-08", "2026-12"])("accepts %s as a monthly key", (key) => {
    expect(isValidPeriodKey("monthly", key)).toBe(true);
  });

  it.each([
    ["2026-13", "month beyond December"],
    ["2026-00", "month zero"],
    ["2026-8", "unpadded month"],
    ["2026-W33", "a week key"],
  ])("rejects %s as a monthly key (%s)", (key) => {
    expect(isValidPeriodKey("monthly", key)).toBe(false);
  });

  // The whole reason PeriodIdentitySchema exists: a bare key cannot be
  // validated, because `2026-08` is a perfectly good month and a nonsense week.
  it("rejects a well-formed key paired with the wrong kind", () => {
    expect(PeriodIdentitySchema.safeParse({ kind: "weekly", key: "2026-08" }).success).toBe(
      false,
    );
    expect(PeriodIdentitySchema.safeParse({ kind: "monthly", key: "2026-W33" }).success).toBe(
      false,
    );
  });

  it("accepts a matched kind/key pair", () => {
    expect(PeriodIdentitySchema.safeParse({ kind: "weekly", key: "2026-W33" }).success).toBe(
      true,
    );
    expect(PeriodIdentitySchema.safeParse({ kind: "monthly", key: "2026-08" }).success).toBe(
      true,
    );
  });

  it("rejects an unknown period kind rather than passing it through", () => {
    expect(PeriodKindSchema.safeParse("quarterly").success).toBe(false);
  });
});

describe("period bounds", () => {
  it("accepts an ordered range", () => {
    expect(PeriodBoundsSchema.safeParse({ start: "2026-08-10", end: "2026-08-16" }).success).toBe(
      true,
    );
  });

  it("accepts a single-day range (end is inclusive)", () => {
    expect(PeriodBoundsSchema.safeParse({ start: "2026-08-10", end: "2026-08-10" }).success).toBe(
      true,
    );
  });

  it("rejects a range whose end precedes its start", () => {
    expect(PeriodBoundsSchema.safeParse({ start: "2026-08-16", end: "2026-08-10" }).success).toBe(
      false,
    );
  });

  it("rejects a timestamp where a local date belongs", () => {
    expect(
      PeriodBoundsSchema.safeParse({ start: "2026-08-10T00:00:00Z", end: "2026-08-16" }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Metric degradation
// ---------------------------------------------------------------------------

describe("PeriodMetric", () => {
  it("accepts a resolved comparison", () => {
    expect(
      PeriodMetricSchema.safeParse({
        status: "under",
        prescribed: 25200,
        actual: 22800,
        deltaPct: -9.5,
      }).success,
    ).toBe(true);
  });

  it("accepts an unavailable metric with no other fields", () => {
    expect(PeriodMetricSchema.safeParse({ status: "unavailable" }).success).toBe(true);
  });

  // KTD8-style structural guarantee: an unavailable metric must not be able to
  // smuggle numbers a caller could read as real.
  it("rejects an unavailable metric that carries numbers", () => {
    expect(
      PeriodMetricSchema.safeParse({
        status: "unavailable",
        prescribed: 0,
        actual: 0,
        deltaPct: 0,
      }).success,
    ).toBe(false);
  });

  // The empty-period (AE2) guard. A naive deltaPct over a zero prescription
  // produces Infinity or NaN; .finite() makes that unrepresentable rather than
  // merely discouraged.
  it.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["NaN", Number.NaN],
  ])("rejects %s in deltaPct", (_label, value) => {
    expect(
      PeriodMetricSchema.safeParse({
        status: "under",
        prescribed: 0,
        actual: 0,
        deltaPct: value,
      }).success,
    ).toBe(false);
  });

  it("rejects a resolved comparison missing a required number", () => {
    expect(
      PeriodMetricSchema.safeParse({ status: "on_target", prescribed: 100, actual: 100 }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Comparison presence vs absence
// ---------------------------------------------------------------------------

describe("PeriodComparison", () => {
  it("accepts an available comparison", () => {
    expect(
      PeriodComparisonSchema.safeParse({
        available: true,
        previousKey: "2026-W32",
        sessionsDeltaPct: 20,
        durationDeltaPct: -5.5,
        loadDeltaPct: 12,
        activeDaysDelta: 1,
      }).success,
    ).toBe(true);
  });

  it("accepts an absent comparison", () => {
    expect(PeriodComparisonSchema.safeParse({ available: false }).success).toBe(true);
  });

  // A brand-new athlete's first week must not be representable as "down 100%".
  it("rejects an absent comparison that carries deltas", () => {
    expect(
      PeriodComparisonSchema.safeParse({ available: false, loadDeltaPct: -100 }).success,
    ).toBe(false);
  });

  it("distinguishes an all-zero available comparison from an absent one", () => {
    const zeroed = PeriodComparisonSchema.parse({
      available: true,
      previousKey: "2026-W32",
      sessionsDeltaPct: 0,
      durationDeltaPct: 0,
      loadDeltaPct: 0,
      activeDaysDelta: 0,
    });
    const absent = PeriodComparisonSchema.parse({ available: false });
    expect(zeroed.available).toBe(true);
    expect(absent.available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Narration (trust boundary)
// ---------------------------------------------------------------------------

describe("PeriodNarration", () => {
  it("accepts a well-formed narration", () => {
    expect(
      PeriodNarrationSchema.safeParse({
        note: "You held five of six sessions together.",
        takeaway: "Keep next week's long ride conversational.",
      }).success,
    ).toBe(true);
  });

  it("rejects a note over the length cap", () => {
    expect(
      PeriodNarrationSchema.safeParse({
        note: "x".repeat(PERIOD_NOTE_MAX_LENGTH + 1),
        takeaway: "ok",
      }).success,
    ).toBe(false);
  });

  it("rejects a takeaway over the length cap", () => {
    expect(
      PeriodNarrationSchema.safeParse({
        note: "ok",
        takeaway: "x".repeat(PERIOD_TAKEAWAY_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects empty strings", () => {
    expect(PeriodNarrationSchema.safeParse({ note: "", takeaway: "ok" }).success).toBe(false);
  });

  // .strict() is the point: a model that invents a `confidence` or `sources`
  // key must be rejected at the boundary, not silently persisted.
  it("rejects a model-invented extra key", () => {
    expect(
      PeriodNarrationSchema.safeParse({
        note: "ok",
        takeaway: "ok",
        confidence: 0.9,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Facts + response round-trip
// ---------------------------------------------------------------------------

const FACTS = {
  kind: "weekly" as const,
  periodKey: "2026-W33",
  bounds: { start: "2026-08-10", end: "2026-08-16" },
  totals: {
    sessions: 5,
    durationS: 22800,
    distanceM: 61000,
    load: 340,
    activeDays: 4,
    loadConfidence: "mixed" as const,
  },
  compliance: { prescribed: 6, completed: 5, unplanned: 0 },
  duration: { status: "under" as const, prescribed: 25200, actual: 22800, deltaPct: -9.5 },
  load: { status: "under" as const, prescribed: 380, actual: 340, deltaPct: -10.5 },
  sports: [
    {
      sport: "run" as const,
      sessions: 3,
      durationS: 12000,
      distanceM: 38000,
      load: 190,
    },
  ],
  comparison: { available: false as const },
};

describe("PeriodFacts", () => {
  it("round-trips a fully-populated period", () => {
    expect(PeriodFactsSchema.safeParse(FACTS).success).toBe(true);
  });

  // AE2: an empty period is a valid report, not an error state.
  it("round-trips an empty period without zero-division artifacts", () => {
    const empty = {
      ...FACTS,
      totals: {
        sessions: 0,
        durationS: 0,
        distanceM: null,
        load: 0,
        activeDays: 0,
        loadConfidence: "none" as const,
      },
      compliance: { prescribed: 4, completed: 0, unplanned: 0 },
      duration: { status: "under" as const, prescribed: 14400, actual: 0, deltaPct: -100 },
      load: { status: "unavailable" as const },
      sports: [],
    };
    expect(PeriodFactsSchema.safeParse(empty).success).toBe(true);
  });

  it("allows a sport with unknown distance to be null rather than zero", () => {
    const swim = {
      ...FACTS,
      sports: [
        { sport: "swim" as const, sessions: 1, durationS: 2400, distanceM: null, load: 40 },
      ],
    };
    expect(PeriodFactsSchema.safeParse(swim).success).toBe(true);
  });

  it("rejects a negative session count", () => {
    expect(
      PeriodFactsSchema.safeParse({
        ...FACTS,
        totals: { ...FACTS.totals, sessions: -1 },
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown sport", () => {
    expect(
      PeriodFactsSchema.safeParse({
        ...FACTS,
        sports: [{ sport: "curling", sessions: 1, durationS: 60, distanceM: null, load: 1 }],
      }).success,
    ).toBe(false);
  });

  it("allows completed to exceed prescribed (an athlete who added sessions)", () => {
    expect(
      PeriodFactsSchema.safeParse({
        ...FACTS,
        compliance: { prescribed: 3, completed: 5, unplanned: 2 },
      }).success,
    ).toBe(true);
  });
});

describe("PeriodReviewResponse", () => {
  it("round-trips a narrated review", () => {
    expect(
      PeriodReviewResponseSchema.safeParse({
        facts: FACTS,
        narration: { note: "Solid week.", takeaway: "Hold the volume." },
        generatedAt: "2026-08-17T18:00:00.000Z",
        stale: false,
        generatable: false,
      }).success,
    ).toBe(true);
  });

  // R15/AE9: the facts always survive a degraded narration.
  it("round-trips a facts-only review with no narration", () => {
    expect(
      PeriodReviewResponseSchema.safeParse({
        facts: FACTS,
        narration: null,
        generatedAt: null,
        stale: false,
        generatable: true,
      }).success,
    ).toBe(true);
  });

  it("round-trips a failed generation attempt carrying retryable", () => {
    expect(
      PeriodReviewResponseSchema.safeParse({
        facts: FACTS,
        narration: null,
        generatedAt: null,
        stale: false,
        generatable: true,
        retryable: true,
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown top-level key", () => {
    expect(
      PeriodReviewResponseSchema.safeParse({
        facts: FACTS,
        narration: null,
        generatedAt: null,
        stale: false,
        generatable: true,
        verdict: "good",
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Email preferences
// ---------------------------------------------------------------------------

describe("EmailPreferencesUpdate", () => {
  it("accepts a single-cadence update", () => {
    expect(EmailPreferencesUpdateSchema.safeParse({ weeklyReview: true }).success).toBe(true);
  });

  it("accepts both cadences at once", () => {
    expect(
      EmailPreferencesUpdateSchema.safeParse({ weeklyReview: true, monthlyReview: false })
        .success,
    ).toBe(true);
  });

  it("rejects an empty update rather than performing a no-op write", () => {
    expect(EmailPreferencesUpdateSchema.safeParse({}).success).toBe(false);
  });

  // A client typo must fail loudly rather than silently not saving.
  it("rejects an unknown preference key", () => {
    expect(
      EmailPreferencesUpdateSchema.safeParse({ weekly_review: true }).success,
    ).toBe(false);
  });

  it("rejects a non-boolean value", () => {
    expect(EmailPreferencesUpdateSchema.safeParse({ weeklyReview: "yes" }).success).toBe(false);
  });
});
