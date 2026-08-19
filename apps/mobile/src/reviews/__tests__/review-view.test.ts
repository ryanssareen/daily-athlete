// Tests for the mobile period-review view logic (U11).
//
// The hooks are not imported here (no React Native renderer in this suite --
// same reason src/reports/__tests__/useWorkoutReport.test.ts gives). Every
// decision lives in review-view.ts precisely so it can be covered this way.

import { describe, expect, it } from "vitest";

import type { PeriodReviewResponse, PeriodReviewSummary } from "@da2/shared";

import {
  formatDistanceM,
  formatDurationS,
  initialReviewState,
  periodSubtitle,
  periodTitle,
  RECENT_PERIODS_LIMIT,
  reviewReducer,
  selectRecentPeriods,
  selectReviewView,
  type ReviewState,
} from "../review-view";

function summary(over: Partial<PeriodReviewSummary> = {}): PeriodReviewSummary {
  return {
    kind: "weekly",
    periodKey: "2026-W33",
    bounds: { start: "2026-08-10", end: "2026-08-16" },
    sessions: 5,
    durationS: 22800,
    load: 340,
    hasNarration: false,
    ...over,
  };
}

const FACTS = {
  kind: "weekly",
  periodKey: "2026-W33",
  bounds: { start: "2026-08-10", end: "2026-08-16" },
  totals: {
    sessions: 5,
    durationS: 22800,
    distanceM: 61000,
    load: 340,
    activeDays: 4,
    loadConfidence: "power",
  },
  compliance: { prescribed: 6, completed: 5, unplanned: 0 },
  duration: { status: "under", prescribed: 25200, actual: 22800, deltaPct: -9.5 },
  load: { status: "under", prescribed: 380, actual: 340, deltaPct: -10.5 },
  sports: [],
  comparison: { available: false },
} as unknown as PeriodReviewResponse["facts"];

const NARRATION = { note: "Solid week.", takeaway: "Hold the volume." };

function response(over: Partial<PeriodReviewResponse> = {}): PeriodReviewResponse {
  return {
    facts: FACTS,
    narration: NARRATION,
    generatedAt: "2026-08-17T07:00:00.000Z",
    stale: false,
    generatable: true,
    ...over,
  } as PeriodReviewResponse;
}

// ---------------------------------------------------------------------------
// Bounded list
// ---------------------------------------------------------------------------

describe("selectRecentPeriods", () => {
  // A cap, not a page size: each row costs the server a context assembly.
  it("caps the list regardless of how many periods came back", () => {
    const many = Array.from({ length: 40 }, (_, i) => summary({ periodKey: `2026-W${i}` }));
    expect(selectRecentPeriods(many)).toHaveLength(RECENT_PERIODS_LIMIT);
  });

  it("returns nothing for an athlete with no periods", () => {
    expect(selectRecentPeriods([])).toEqual([]);
  });

  it("preserves the server's ordering", () => {
    const list = [summary({ periodKey: "2026-W33" }), summary({ periodKey: "2026-W32" })];
    expect(selectRecentPeriods(list).map((p) => p.periodKey)).toEqual(["2026-W33", "2026-W32"]);
  });
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

describe("formatting", () => {
  it("renders unknown distance as an em dash, never 0.0 km", () => {
    expect(formatDistanceM(null)).toBe("—");
  });

  it("renders a genuine zero distance as zero", () => {
    expect(formatDistanceM(0)).toBe("0.0 km");
  });

  it.each([
    [0, "0m"],
    [1800, "30m"],
    [22800, "6h 20m"],
  ])("formats %i seconds as %s", (input, expected) => {
    expect(formatDurationS(input)).toBe(expected);
  });

  it("titles a week by its starting day", () => {
    expect(periodTitle("weekly", { start: "2026-08-10" })).toBe("Week of 10 Aug");
  });

  it("titles a month by name and year", () => {
    expect(periodTitle("monthly", { start: "2026-08-01" })).toBe("August 2026");
  });

  it("summarises a period with sessions", () => {
    expect(periodSubtitle(summary())).toBe("5 sessions · 6h 20m · load 340");
  });

  it("uses the singular for one session", () => {
    expect(periodSubtitle(summary({ sessions: 1 }))).toContain("1 session ·");
  });

  it("says so plainly when nothing was logged", () => {
    expect(periodSubtitle(summary({ sessions: 0 }))).toBe("No sessions logged");
  });
});

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

describe("reviewReducer", () => {
  const ready: ReviewState = {
    ...initialReviewState,
    phase: "ready",
    response: response(),
  };

  it("moves to ready on a successful fetch", () => {
    const next = reviewReducer(initialReviewState, {
      type: "fetch_success",
      response: response(),
    });
    expect(next.phase).toBe("ready");
    expect(next.response).not.toBeNull();
  });

  // THE DEFINING PROPERTY: the facts are already true and must not be hidden
  // behind a spinner while the narration is written.
  it("never clears the response when a generate starts", () => {
    const next = reviewReducer(ready, { type: "generate_start" });
    expect(next.response).toBe(ready.response);
    expect(next.generating).toBe(true);
  });

  it("does not drop back to loading on a refetch when data is already shown", () => {
    expect(reviewReducer(ready, { type: "fetch_start" }).phase).toBe("ready");
  });

  it("keeps showing data when a refetch fails", () => {
    const next = reviewReducer(ready, { type: "fetch_error" });
    expect(next.phase).toBe("ready");
    expect(next.response).not.toBeNull();
  });

  it("surfaces an error when the first fetch fails with nothing to show", () => {
    expect(reviewReducer(initialReviewState, { type: "fetch_error" }).phase).toBe("error");
  });

  it("stores the narration a successful generate returned", () => {
    const next = reviewReducer(ready, { type: "generate_success", response: response() });
    expect(next.generating).toBe(false);
    expect(next.generateOutcome).toBeNull();
  });

  // A 200 with no narration is a FAILED generation -- the route returns the
  // facts intact on an LLM failure, so status alone reads as success.
  it("treats a 200 carrying no narration as a failure", () => {
    const next = reviewReducer(ready, {
      type: "generate_success",
      response: response({ narration: null, retryable: true }),
    });
    expect(next.generateOutcome).toBe("retryable");
  });

  it("distinguishes a permanent failure from a retryable one", () => {
    const next = reviewReducer(ready, {
      type: "generate_success",
      response: response({ narration: null, retryable: false }),
    });
    expect(next.generateOutcome).toBe("failed");
  });

  it("does not promise a retry when the response says nothing about one", () => {
    const next = reviewReducer(ready, {
      type: "generate_success",
      response: response({ narration: null }),
    });
    expect(next.generateOutcome).toBe("failed");
  });

  it("keeps a quota refusal distinct from a model failure", () => {
    expect(reviewReducer(ready, { type: "generate_rate_limited" }).generateOutcome).toBe(
      "rate_limited",
    );
  });

  it("clears a previous notice when a new generate starts", () => {
    const withNotice = { ...ready, generateOutcome: "failed" as const };
    expect(reviewReducer(withNotice, { type: "generate_start" }).generateOutcome).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// View selection
// ---------------------------------------------------------------------------

describe("selectReviewView", () => {
  it("is null before the first response arrives", () => {
    expect(selectReviewView(initialReviewState)).toBeNull();
  });

  it("exposes the facts and narration", () => {
    const view = selectReviewView({ ...initialReviewState, response: response() })!;
    expect(view.facts.totals.sessions).toBe(5);
    expect(view.narration).toEqual(NARRATION);
    expect(view.notice).toBeNull();
  });

  it("carries staleness through", () => {
    const view = selectReviewView({
      ...initialReviewState,
      response: response({ stale: true }),
    })!;
    expect(view.stale).toBe(true);
  });

  it.each([
    ["retryable", /busy/i],
    ["rate_limited", /a lot of reviews/i],
    ["failed", /couldn't write/i],
  ])("renders a distinct notice for %s", (outcome, pattern) => {
    const view = selectReviewView({
      ...initialReviewState,
      response: response({ narration: null }),
      generateOutcome: outcome as ReviewState["generateOutcome"],
    })!;
    expect(view.notice).toMatch(pattern);
  });
});
