// Unit tests for the web report section (Unit U7,
// docs/plans/2026-08-18-001-feat-workout-reports-plan.md).
//
// The web vitest env is Node-only (no jsdom / react-testing-library —
// confirmed against vitest.config.ts's `environment: "node"` and
// package.json, which carries neither dependency) — exactly like
// app/(athlete)/plan/__tests__/page.test.tsx's precedent for this same repo.
// So, per that precedent, this file exercises the surface's *view logic*
// (narrativeAffordances, visibleDimensionRows, verdictTone, the pure
// pending-state-machine transitions, and the fetch-shaped defaultReportApi)
// rather than rendering JSX. Every conditional in ReportSection.tsx's markup
// reads from `narrativeAffordances` and ComparisonRows.tsx's markup reads
// from `visibleDimensionRows` — asserting on those functions' output IS
// asserting on what the component renders, not a parallel reimplementation
// that could drift from it.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DimensionDelta, ExecutionDelta, IntensityDimensionDelta, WorkoutReportResponse } from "@da2/shared";

import { visibleDimensionRows } from "../ComparisonRows";
import { verdictTone } from "../VerdictHeader";
import {
  defaultReportApi,
  failGenerate,
  finishGenerate,
  narrativeAffordances,
  narrativeStateFor,
  startGenerate,
  type ReportViewState,
} from "../ReportSection";

// --- Fixtures ----------------------------------------------------------------

const ON_TARGET_DURATION: DimensionDelta = { status: "on_target", prescribed: 3600, actual: 3480, deltaPct: -3.3 };
const ON_TARGET_LOAD: DimensionDelta = { status: "on_target", prescribed: 55, actual: 58, deltaPct: 5.5 };
const ON_TARGET_INTENSITY: IntensityDimensionDelta = {
  status: "on_target",
  target: { kind: "ftp_pct", value: 75 },
  prescribed: 75,
  actual: 76,
  deltaPct: 1.3,
};

function matchedDelta(overrides: Partial<ExecutionDelta & { matched: true }> = {}): ExecutionDelta {
  return {
    matched: true,
    dimensions: {
      duration: ON_TARGET_DURATION,
      load: ON_TARGET_LOAD,
      intensity: ON_TARGET_INTENSITY,
    },
    verdict: { code: "executed_as_prescribed", headline: "Executed as prescribed" },
    ...overrides,
  };
}

function unmatchedDelta(): ExecutionDelta {
  return { matched: false, verdict: { code: "unplanned_effort", headline: "An unplanned effort" } };
}

function report(overrides: Partial<WorkoutReportResponse> = {}): WorkoutReportResponse {
  return {
    delta: matchedDelta(),
    narration: null,
    stale: false,
    generatable: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// --- Scenario 1: absent narration -> verdict + comparison render, Generate offered --

describe("narrativeAffordances — absent (no prior attempt)", () => {
  it("verdict headline and comparison rows are present; Generate report is the only affordance", () => {
    const r = report({ narration: null, stale: false });

    // Verdict + comparison come straight off the payload — no gating.
    expect(r.delta.verdict.headline).toBe("Executed as prescribed");
    expect(visibleDimensionRows(r.delta)).toHaveLength(3);

    const aff = narrativeAffordances(r, false);
    expect(aff.kind).toBe("absent");
    expect(aff.showNote).toBe(false);
    expect(aff.showStaleBadge).toBe(false);
    expect(aff.actionLabel).toBe("Generate report");
    expect(aff.actionDisabled).toBe(false);
  });
});

// --- Scenario 2: present narration -> note + takeaway, no generate affordance ------

describe("narrativeAffordances — present", () => {
  it("shows the note + takeaway and offers no generate action", () => {
    const r = report({ narration: { note: "Solid session.", takeaway: "Keep this pace next week." }, stale: false });

    const aff = narrativeAffordances(r, false);
    expect(aff.kind).toBe("present");
    expect(aff.showNote).toBe(true);
    expect(aff.showStaleBadge).toBe(false);
    expect(aff.actionLabel).toBeNull();
    expect(aff.retryMessage).toBeNull();
  });
});

// --- Scenario 3: stale -> narrative still shown, PLUS stale marker + regenerate ----

describe("narrativeAffordances — stale", () => {
  it("keeps the stored narrative visible and adds the stale badge + regenerate affordance", () => {
    const r = report({
      narration: { note: "Solid session.", takeaway: "Keep this pace next week." },
      stale: true,
    });

    const aff = narrativeAffordances(r, false);
    expect(aff.kind).toBe("stale");
    // Not hidden — still "mostly useful" per the plan.
    expect(aff.showNote).toBe(true);
    expect(aff.showStaleBadge).toBe(true);
    expect(aff.actionLabel).toBe("Regenerate report");
  });
});

// --- Scenario 4: unmatched -> no comparison block, narrative area still offered ----

describe("unmatched delta (AE3 / F2)", () => {
  it("visibleDimensionRows is empty for an unmatched delta (component renders no comparison block)", () => {
    expect(visibleDimensionRows(unmatchedDelta())).toEqual([]);
  });

  it("the narrative area still works for an unplanned effort", () => {
    const r = report({ delta: unmatchedDelta(), narration: null });
    expect(r.delta.verdict.code).toBe("unplanned_effort");
    const aff = narrativeAffordances(r, false);
    expect(aff.actionLabel).toBe("Generate report");
  });
});

// --- Scenario 5: unavailable dimensions are omitted, never dashed/blanked ----------

describe("visibleDimensionRows — unavailable dimensions", () => {
  it("omits unavailable dimensions entirely rather than rendering a placeholder", () => {
    const delta = matchedDelta({
      dimensions: {
        duration: { status: "unavailable" },
        load: ON_TARGET_LOAD,
        intensity: { status: "unavailable" },
      },
    });
    const rows = visibleDimensionRows(delta);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("load");
    expect(rows.some((r) => r.key === "duration")).toBe(false);
    expect(rows.some((r) => r.key === "intensity")).toBe(false);
  });

  it("a fully-unavailable matched delta renders no comparison rows at all", () => {
    const delta = matchedDelta({
      dimensions: {
        duration: { status: "unavailable" },
        load: { status: "unavailable" },
        intensity: { status: "unavailable" },
      },
    });
    expect(visibleDimensionRows(delta)).toEqual([]);
  });
});

// --- Scenario 6: generate pending -> disabled control + loading label; verdict stays --

describe("pending generate state (Scenario 6) / KTD2 guard", () => {
  it("disables the action and shows a loading label while pending", () => {
    const r = report({ narration: null });
    const aff = narrativeAffordances(r, true);
    expect(aff.actionDisabled).toBe(true);
    expect(aff.actionLabel).toBe("Generating…");
  });

  it("KTD2 guard: entering the pending state never clears or replaces the verdict/comparison data", () => {
    const initial: ReportViewState = { report: report({ narration: null }), pending: false, requestError: null };
    const pending = startGenerate(initial);

    expect(pending.pending).toBe(true);
    // The exact same delta object survives the transition — nothing about
    // starting a generate request touches the verdict-bearing data. This is
    // the structural guarantee that lets VerdictHeader/ComparisonRows render
    // unconditionally with no spinner while narration loads.
    expect(pending.report.delta).toBe(initial.report.delta);
    expect(pending.report.delta.verdict.headline.length).toBeGreaterThan(0);
    expect(visibleDimensionRows(pending.report.delta)).toHaveLength(3);
  });

  it("a regenerate-in-flight (stale) keeps the old narrative + verdict visible throughout", () => {
    const initial: ReportViewState = {
      report: report({ narration: { note: "n", takeaway: "t" }, stale: true }),
      pending: false,
      requestError: null,
    };
    const pending = startGenerate(initial);
    const aff = narrativeAffordances(pending.report, pending.pending);
    expect(aff.showNote).toBe(true); // old narrative still shown
    expect(aff.actionLabel).toBe("Regenerating…");
    expect(pending.report.delta).toBe(initial.report.delta);
  });
});

// --- Scenario 7: retryable: true -> retry affordance, not an error boundary --------

describe("narrativeAffordances — retryable_failed (Scenario 7 / AE6)", () => {
  it("retryable: true renders a retry affordance and the verdict stays intact (no throw)", () => {
    const r = report({ narration: null, stale: false, retryable: true });
    expect(() => narrativeAffordances(r, false)).not.toThrow();

    const aff = narrativeAffordances(r, false);
    expect(aff.kind).toBe("retryable_failed");
    expect(aff.actionLabel).toBe("Try again");
    expect(aff.retryMessage).toBeTruthy();

    // Verdict/comparison are untouched by the failure — no error boundary,
    // the delta from the failed POST's response is still perfectly usable.
    expect(r.delta.verdict.headline).toBeTruthy();
    expect(visibleDimensionRows(r.delta)).toHaveLength(3);
  });

  it("retryable: false shows a static failure message with no retry action", () => {
    const r = report({ narration: null, stale: false, retryable: false });
    const aff = narrativeAffordances(r, false);
    expect(aff.kind).toBe("retryable_failed");
    expect(aff.actionLabel).toBeNull();
    expect(aff.retryMessage).toBeTruthy();
  });
});

// --- narrativeStateFor — the four states, once each -------------------------------

describe("narrativeStateFor", () => {
  it("maps every combination to exactly one of the four required states", () => {
    expect(narrativeStateFor({ narration: null, stale: false, retryable: undefined })).toBe("absent");
    expect(narrativeStateFor({ narration: { note: "n", takeaway: "t" }, stale: false, retryable: undefined })).toBe(
      "present"
    );
    expect(narrativeStateFor({ narration: { note: "n", takeaway: "t" }, stale: true, retryable: undefined })).toBe(
      "stale"
    );
    expect(narrativeStateFor({ narration: null, stale: false, retryable: true })).toBe("retryable_failed");
    expect(narrativeStateFor({ narration: null, stale: false, retryable: false })).toBe("retryable_failed");
  });
});

// --- verdictTone — closed VerdictCode -> tone mapping ------------------------------

describe("verdictTone", () => {
  it("maps every VerdictCode to a tone", () => {
    expect(verdictTone("executed_as_prescribed")).toBe("positive");
    expect(verdictTone("under_executed")).toBe("warning");
    expect(verdictTone("over_executed")).toBe("warning");
    expect(verdictTone("partial_data")).toBe("neutral");
    expect(verdictTone("unplanned_effort")).toBe("neutral");
  });
});

// --- Pure state machine (finishGenerate / failGenerate) ----------------------------

describe("finishGenerate / failGenerate", () => {
  it("finishGenerate replaces the report and clears pending + requestError", () => {
    const initial: ReportViewState = { report: report({ narration: null }), pending: true, requestError: null };
    const fresh = report({ narration: { note: "n", takeaway: "t" }, stale: false });
    const next = finishGenerate(initial, fresh);
    expect(next).toEqual({ report: fresh, pending: false, requestError: null });
  });

  it("failGenerate clears pending, sets requestError, and leaves the prior report untouched", () => {
    const priorReport = report({ narration: null });
    const initial: ReportViewState = { report: priorReport, pending: true, requestError: null };
    const next = failGenerate(initial, "Couldn't generate the report. Try again.");
    expect(next.pending).toBe(false);
    expect(next.requestError).toBe("Couldn't generate the report. Try again.");
    expect(next.report).toBe(priorReport);
  });
});

// --- defaultReportApi (POST shape) -------------------------------------------------

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("defaultReportApi.generate", () => {
  it("POSTs to /api/workouts/:id/report and returns the parsed payload", async () => {
    const body: WorkoutReportResponse = report({ narration: { note: "n", takeaway: "t" }, stale: false });
    const fetchSpy = mockFetch(200, body);
    vi.stubGlobal("fetch", fetchSpy);

    const result = await defaultReportApi.generate("workout-1");
    expect(result).toEqual(body);

    const call = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/workouts/workout-1/report");
    expect(call[1].method).toBe("POST");
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal("fetch", mockFetch(500, { error: "internal" }));
    await expect(defaultReportApi.generate("workout-1")).rejects.toThrow();
  });

  it("throws when the response body fails schema validation", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { not: "a valid report" }));
    await expect(defaultReportApi.generate("workout-1")).rejects.toThrow();
  });
});

// --- Scenario 8: superseded — the verdict category flipped under a stored note ---

describe("narrativeAffordances — superseded (verdictChanged)", () => {
  it("SUPPRESSES the stored note and explains why, offering regeneration", () => {
    const aff = narrativeAffordances(
      report({
        delta: matchedDelta({ verdict: { code: "executed_as_prescribed", headline: "Executed as prescribed" } }),
        narration: { note: "You came up well short today.", takeaway: "Aim for the full duration." },
        stale: true,
        verdictChanged: true,
      }),
      false
    );

    expect(aff.kind).toBe("superseded");
    // THE POINT: prose explaining "under-executed" must not sit under an
    // "As prescribed" header — the two visibly contradict and the athlete
    // has no way to tell which is right.
    expect(aff.showNote).toBe(false);
    expect(aff.supersededMessage).not.toBeNull();
    expect(aff.actionLabel).toBe("Regenerate report");
  });

  it("stale WITHOUT a verdict flip still shows the note behind a badge", () => {
    const aff = narrativeAffordances(
      report({
        narration: { note: "Solid session.", takeaway: "Again next week." },
        stale: true,
      }),
      false
    );

    expect(aff.kind).toBe("stale");
    expect(aff.showNote).toBe(true);
    expect(aff.showStaleBadge).toBe(true);
    expect(aff.supersededMessage).toBeNull();
  });

  it("shows the regenerating label while pending", () => {
    const aff = narrativeAffordances(
      report({
        narration: { note: "Old.", takeaway: "Old." },
        stale: true,
        verdictChanged: true,
      }),
      true
    );
    expect(aff.actionLabel).toBe("Regenerating…");
    expect(aff.actionDisabled).toBe(true);
  });
});

// --- Scenario 9: a failed regeneration must not blank a note that is on screen ---
//
// The route returns the STILL-STORED narrative alongside `retryable` when
// regeneration fails (it wrote no row, so the old note remains the truth in
// the database). These pin that the view keeps showing it.

describe("narrativeAffordances — failed attempt over an existing note", () => {
  it("keeps the note visible and adds retry copy + a retry button", () => {
    const aff = narrativeAffordances(
      report({
        narration: { note: "The note the athlete is reading.", takeaway: "Their takeaway." },
        stale: false,
        retryable: true,
      }),
      false
    );

    expect(aff.kind).toBe("present");
    expect(aff.showNote).toBe(true);
    expect(aff.retryMessage).toBe("We couldn't generate a narrative right now.");
    expect(aff.actionLabel).toBe("Try again");
  });

  it("a permanent failure over an existing note keeps the note but offers no retry", () => {
    const aff = narrativeAffordances(
      report({
        narration: { note: "The note the athlete is reading.", takeaway: "Their takeaway." },
        stale: false,
        retryable: false,
      }),
      false
    );

    expect(aff.showNote).toBe(true);
    expect(aff.retryMessage).toBe("We couldn't generate a narrative for this workout.");
    expect(aff.actionLabel).toBeNull();
  });

  it("a failed regeneration over a STALE note keeps the stale bar's own button (no duplicate)", () => {
    const aff = narrativeAffordances(
      report({
        narration: { note: "Old note.", takeaway: "Old takeaway." },
        stale: true,
        retryable: true,
      }),
      false
    );

    expect(aff.kind).toBe("stale");
    expect(aff.showNote).toBe(true);
    expect(aff.showStaleBadge).toBe(true);
    expect(aff.retryMessage).not.toBeNull();
    // The stale bar renders this label; the retry block below it renders the
    // message only (ReportSection's JSX gates the second button on
    // kind === "retryable_failed" || kind === "present").
    expect(aff.actionLabel).toBe("Regenerate report");
  });

  it("no attempt -> no retry copy anywhere", () => {
    const aff = narrativeAffordances(
      report({ narration: { note: "Fresh.", takeaway: "Fresh." }, stale: false }),
      false
    );
    expect(aff.retryMessage).toBeNull();
    expect(aff.actionLabel).toBeNull();
  });
});

describe("narrativeStateFor — precedence", () => {
  it("verdictChanged outranks stale", () => {
    expect(
      narrativeStateFor({
        narration: { note: "n", takeaway: "t" },
        stale: true,
        verdictChanged: true,
      })
    ).toBe("superseded");
  });

  it("an attempt that failed but returned prose is NOT retryable_failed", () => {
    expect(
      narrativeStateFor({ narration: { note: "n", takeaway: "t" }, stale: false, retryable: true })
    ).toBe("present");
  });

  it("only a failure with nothing stored reaches retryable_failed", () => {
    expect(narrativeStateFor({ narration: null, stale: false, retryable: true })).toBe(
      "retryable_failed"
    );
  });
});
