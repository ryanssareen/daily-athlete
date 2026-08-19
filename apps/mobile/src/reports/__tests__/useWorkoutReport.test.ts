// Unit tests for the mobile workout-report surface's decision logic (Unit U8).
//
// The mobile vitest env is Node-only and must not import react-native / expo
// (per vitest.config.ts) -- useWorkoutReport.ts itself pulls in `@/api/client`
// and `@/auth/supabase`, which transitively import expo-constants,
// @react-native-async-storage/async-storage, and react-native-url-polyfill,
// none of which resolve under plain Node/vitest (confirmed: importing
// `@/api/client` here fails to parse). So — exactly like
// src/adaptive/__tests__/useProposal.test.ts, which tests proposal-view.ts
// rather than useProposal.ts -- this suite covers report-view.ts: the pure
// view-model mapping AND the pure `reportReducer`/`selectReportView` state
// machine that useWorkoutReport.ts is a thin `useReducer` shell around. Every
// "Hook does X" scenario below is really "the reducer transition + selector
// the hook dispatches into does X", which is what the hook actually runs.

import { describe, expect, it } from "vitest";

import type { ExecutionDelta, Verdict, WorkoutReportResponse } from "@da2/shared";

import {
  type GenerateResponse,
  initialReportState,
  RECENT_WORKOUTS_LIMIT,
  type ReportState,
  reportReducer,
  selectRecentWorkoutIds,
  selectReportView,
  toReportView,
} from "../report-view";

// --- Fixtures ----------------------------------------------------------------

const VERDICT_ON_TRACK: Verdict = { code: "executed_as_prescribed", headline: "Executed as prescribed" };
const VERDICT_UNPLANNED: Verdict = { code: "unplanned_effort", headline: "Unplanned effort" };

const MATCHED_DELTA: ExecutionDelta = {
  matched: true,
  verdict: VERDICT_ON_TRACK,
  dimensions: {
    duration: { status: "on_target", prescribed: 3600, actual: 3480, deltaPct: -3.3 },
    load: { status: "over", prescribed: 55, actual: 61, deltaPct: 10.9 },
    intensity: { status: "unavailable" },
  },
};

const UNMATCHED_DELTA: ExecutionDelta = { matched: false, verdict: VERDICT_UNPLANNED };

function response(overrides: Partial<WorkoutReportResponse> = {}): WorkoutReportResponse {
  return {
    delta: MATCHED_DELTA,
    narration: null,
    stale: false,
    generatable: true,
    ...overrides,
  };
}

function fetchSuccess(state: ReportState, res: WorkoutReportResponse): ReportState {
  return reportReducer(state, { type: "fetch_success", response: res });
}

// --- 1. Verdict + comparison render while narrative is null ------------------

describe("toReportView", () => {
  it("returns verdict and comparison while narrative is null", () => {
    const view = toReportView(response());
    expect(view.verdict).toEqual(VERDICT_ON_TRACK);
    expect(view.comparison).toEqual({
      matched: true,
      rows: [
        { key: "duration", label: "Duration", status: "on_target", prescribed: 3600, actual: 3480, deltaPct: -3.3 },
        { key: "load", label: "Load", status: "over", prescribed: 55, actual: 61, deltaPct: 10.9 },
        // intensity omitted entirely -- status "unavailable" (KTD8), never a dash/"n/a".
      ],
    });
    expect(view.narrative).toEqual({ status: "absent" });
  });

  // --- 6. Unmatched workout -> no comparison section --------------------------
  it("omits the comparison section entirely for an unmatched workout", () => {
    const view = toReportView(response({ delta: UNMATCHED_DELTA }));
    expect(view.comparison).toEqual({ matched: false });
    expect(view.verdict).toEqual(VERDICT_UNPLANNED);
    // Narrative area still works even though there's nothing to compare against.
    expect(view.narrative.status).toBe("absent");
  });

  // --- 3. stale: true -> marks stale AND keeps the narrative visible ----------
  it("marks stale and keeps the narrative visible when stale: true", () => {
    const view = toReportView(
      response({ narration: { note: "Solid endurance ride.", takeaway: "Keep the volume steady." }, stale: true })
    );
    expect(view.narrative).toEqual({
      status: "stale",
      note: "Solid endurance ride.",
      takeaway: "Keep the volume steady.",
    });
  });
});

// --- 2. generate() POSTs and refreshes ----------------------------------------

describe("reportReducer: generate action POSTs and refreshes", () => {
  it("goes ready -> generating -> ready with the new narrative after a successful POST", () => {
    let state = fetchSuccess(initialReportState, response());
    expect(selectReportView(state)?.narrative).toEqual({ status: "absent" });

    state = reportReducer(state, { type: "generate_start" });
    expect(state.generating).toBe(true);

    const generated: GenerateResponse = response({
      narration: { note: "You executed this session as prescribed.", takeaway: "Repeat this pacing next week." },
    });
    state = reportReducer(state, { type: "generate_success", response: generated });

    expect(state.generating).toBe(false);
    expect(state.phase).toBe("ready");
    expect(selectReportView(state)?.narrative).toEqual({
      status: "present",
      note: "You executed this session as prescribed.",
      takeaway: "Repeat this pacing next week.",
    });
  });
});

// --- CRITICAL (KTD2): the verdict paints before any narration request resolves ---

describe("KTD2: verdict renders for the full lifetime of a generate() POST", () => {
  it("keeps the verdict and comparison on screen while generating is true, before the POST resolves", () => {
    let state = fetchSuccess(initialReportState, response());
    const beforeGenerate = selectReportView(state);
    expect(beforeGenerate?.verdict).toEqual(VERDICT_ON_TRACK);
    expect(beforeGenerate?.comparison.matched).toBe(true);

    // The instant generate() is called (POST in flight, unresolved).
    state = reportReducer(state, { type: "generate_start" });
    expect(state.generating).toBe(true);

    // No spinner gating the verdict: reportReducer's "generate_start" branch
    // never touches `response`, so the same verdict/comparison the athlete
    // already saw on GET is still exactly what selectReportView produces.
    const duringGenerate = selectReportView(state);
    expect(duringGenerate?.verdict).toEqual(VERDICT_ON_TRACK);
    expect(duringGenerate?.comparison).toEqual(beforeGenerate?.comparison);
    expect(state.phase).toBe("ready"); // not "loading" -- no full-screen spinner state entered.
  });
});

// --- 4. retryable: true -> exposes retry, not an error ------------------------

describe("retryable POST outcome", () => {
  it("exposes a retry state (not an error) when the POST returns retryable: true", () => {
    let state = fetchSuccess(initialReportState, response());
    state = reportReducer(state, { type: "generate_start" });
    const failed: GenerateResponse = { ...response(), narration: null, retryable: true };
    state = reportReducer(state, { type: "generate_success", response: failed });

    expect(state.phase).toBe("ready"); // never "error"
    expect(selectReportView(state)?.narrative).toEqual({ status: "retryable" });
    // The verdict/comparison from the last GET are still intact.
    expect(selectReportView(state)?.verdict).toEqual(VERDICT_ON_TRACK);
  });

  it("distinguishes a permanent failure (retryable: false) as 'failed', not 'retryable'", () => {
    let state = fetchSuccess(initialReportState, response());
    state = reportReducer(state, { type: "generate_start" });
    const failed: GenerateResponse = { ...response(), narration: null, retryable: false };
    state = reportReducer(state, { type: "generate_success", response: failed });

    expect(selectReportView(state)?.narrative).toEqual({ status: "failed" });
  });
});

// --- 5. ApiError 404 -> not-found state, no crash ------------------------------

describe("not-found handling", () => {
  it("maps a 404 to a not_found phase with no view to render, without throwing", () => {
    const state = reportReducer(initialReportState, { type: "fetch_not_found" });
    expect(state.phase).toBe("not_found");
    expect(() => selectReportView(state)).not.toThrow();
    expect(selectReportView(state)).toBeNull();
  });

  it("maps any other fetch failure to a plain error phase", () => {
    const state = reportReducer(initialReportState, { type: "fetch_error" });
    expect(state.phase).toBe("error");
    expect(selectReportView(state)).toBeNull();
  });
});

// --- 7. Insights tab, zero completed workouts -> empty state, no request storm ---

describe("selectRecentWorkoutIds: bounds the Insights tab's report fan-out", () => {
  it("returns no ids for zero completed workouts, so zero report GETs fire", () => {
    expect(selectRecentWorkoutIds([])).toEqual([]);
  });

  it("caps the id list at RECENT_WORKOUTS_LIMIT regardless of how many workouts exist", () => {
    const many = Array.from({ length: RECENT_WORKOUTS_LIMIT * 5 }, (_, i) => `workout-${i}`);
    const ids = selectRecentWorkoutIds(many);
    expect(ids).toHaveLength(RECENT_WORKOUTS_LIMIT);
    expect(ids).toEqual(many.slice(0, RECENT_WORKOUTS_LIMIT));
  });

  it("passes small lists through unchanged (no over-eager truncation)", () => {
    expect(selectRecentWorkoutIds(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
});

// --- 7. A failed regeneration must not blank a note that is on screen ---------
//
// The route writes no row on a narration failure and hands back the STILL
// STORED narrative alongside `retryable`, so the note remains the truth in
// the database. The view keeps showing it and surfaces the failure beside it
// via `attemptFailed` — nulling it out would erase prose the athlete is
// mid-sentence in.

describe("failed regeneration preserves a displayed note", () => {
  const STORED = { note: "The note the athlete is reading.", takeaway: "Their takeaway." };

  it("keeps the note and flags the failed attempt as retryable", () => {
    let state = fetchSuccess(initialReportState, response({ narration: STORED }));
    state = reportReducer(state, { type: "generate_start" });
    const failed: GenerateResponse = {
      ...response({ narration: STORED, stale: true }),
      retryable: true,
    };
    state = reportReducer(state, { type: "generate_success", response: failed });

    const view = selectReportView(state);
    expect(view?.narrative).toEqual({ status: "stale", ...STORED });
    expect(view?.attemptFailed).toBe(true);
    expect(view?.attemptRetryable).toBe(true);
  });

  it("a permanent failure over an existing note keeps the note, retryable false", () => {
    let state = fetchSuccess(initialReportState, response({ narration: STORED }));
    state = reportReducer(state, { type: "generate_start" });
    const failed: GenerateResponse = { ...response({ narration: STORED }), retryable: false };
    state = reportReducer(state, { type: "generate_success", response: failed });

    const view = selectReportView(state);
    expect(view?.narrative).toEqual({ status: "present", ...STORED });
    expect(view?.attemptFailed).toBe(true);
    expect(view?.attemptRetryable).toBe(false);
  });

  it("a failed FIRST generation (nothing stored) still reads as retryable", () => {
    let state = fetchSuccess(initialReportState, response());
    state = reportReducer(state, { type: "generate_start" });
    const failed: GenerateResponse = { ...response(), narration: null, retryable: true };
    state = reportReducer(state, { type: "generate_success", response: failed });

    expect(selectReportView(state)?.narrative).toEqual({ status: "retryable" });
  });

  it("a successful generate clears the failure flags", () => {
    let state = fetchSuccess(initialReportState, response());
    state = reportReducer(state, { type: "generate_start" });
    state = reportReducer(state, {
      type: "generate_success",
      response: response({ narration: STORED }),
    });

    const view = selectReportView(state);
    expect(view?.narrative).toEqual({ status: "present", ...STORED });
    expect(view?.attemptFailed).toBe(false);
  });
});

// --- 8. verdictChanged: the stored note explains a verdict no longer shown ----

describe("superseded narrative (verdictChanged)", () => {
  it("withholds the note entirely rather than showing it under a contradicting verdict", () => {
    const state = fetchSuccess(
      initialReportState,
      response({
        narration: { note: "You came up well short today.", takeaway: "Aim for the full duration." },
        stale: true,
        verdictChanged: true,
      })
    );

    const view = selectReportView(state);
    // The delta above still says "executed as prescribed" — printing prose
    // that says the opposite would leave the athlete unable to tell which to
    // believe.
    expect(view?.verdict).toEqual(VERDICT_ON_TRACK);
    expect(view?.narrative).toEqual({ status: "superseded" });
  });

  it("stale WITHOUT a verdict flip still shows the note", () => {
    const state = fetchSuccess(
      initialReportState,
      response({ narration: { note: "Solid.", takeaway: "Again." }, stale: true })
    );
    expect(selectReportView(state)?.narrative).toEqual({
      status: "stale",
      note: "Solid.",
      takeaway: "Again.",
    });
  });
});
