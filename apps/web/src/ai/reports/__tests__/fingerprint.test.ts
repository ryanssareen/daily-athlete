// Unit tests for computeFingerprint (plan Unit U4 / KTD4).
//
// KTD4: the fingerprint hashes ONLY {distance_m, duration_s, sport,
// summary_stats, matched_planned_workout_id, planned_structure, planned_load,
// superseded_by_id, plan_goal, plan_event_date}. Every test below either
// proves STABILITY (a non-material change leaves the hash byte-identical --
// this is what makes AE4 true) or SENSITIVITY (each material field, changed
// alone, changes the hash), plus a dedicated canonical-serialization test
// (key-insertion-order independence).
//
// recentLoad is deliberately NOT hashed even though it reaches the prompt --
// see fingerprint.ts's header for why. The stability test below pins that.

import { describe, expect, it } from "vitest";

import type { LoadState } from "@/training-load";

import { canonicalize, computeFingerprint } from "../fingerprint";
import type { MatchedPlannedWorkout, ReportContext } from "../context";

const FAKE_LOAD_STATE: LoadState = {
  series: [],
  ctl: 0,
  atl: 0,
  tsb: 0,
  ctlRampPerWeek: 0,
  powerConfidenceRatio: 0,
};

function buildMatch(over: Partial<MatchedPlannedWorkout> = {}): MatchedPlannedWorkout {
  return {
    id: "pw-1",
    scheduled_date: "2026-06-10",
    sport: "run",
    status: "completed",
    structure: { duration_s: 3600, load: 55 },
    planned_load: 55,
    duration_s: 3600,
    load: 55,
    intensity_target: null,
    match: {
      id: "match-1",
      confidence: 0.9,
      method: "auto_same_day_sport",
      matched_at: "2026-06-10T09:00:00.000Z",
    },
    ...over,
  };
}

function buildContext(over: Partial<ReportContext> = {}): ReportContext {
  return {
    athleteId: "athlete-1",
    completedWorkout: {
      id: "cw-1",
      sport: "run",
      started_at: "2026-06-10T08:00:00.000Z",
      distance_m: 10000,
      duration_s: 3000,
      summary_stats: { tss: 55, average_heartrate: 150 },
      superseded_by_id: null,
    },
    match: buildMatch(),
    profile: null,
    plan: null,
    recentLoad: FAKE_LOAD_STATE,
    ...over,
  };
}

describe("computeFingerprint — determinism", () => {
  it("is deterministic: the same context hashes identically across calls", () => {
    const ctx = buildContext();
    expect(computeFingerprint(ctx)).toBe(computeFingerprint(buildContext()));
    expect(computeFingerprint(ctx)).toBe(computeFingerprint(ctx));
  });

  it("produces a sha256 hex digest", () => {
    const fp = computeFingerprint(buildContext());
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("computeFingerprint — canonical serialization (key order independence)", () => {
  it("canonicalize sorts nested object keys but preserves array element order", () => {
    const a = canonicalize({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalize({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    const arr = canonicalize({ list: [{ y: 1, x: 2 }, { b: 1, a: 2 }] }) as {
      list: unknown[];
    };
    expect(arr.list).toEqual([
      { x: 2, y: 1 },
      { a: 2, b: 1 },
    ]);
  });

  it("AE4 / U4: re-serializing the same context with keys inserted in a different order yields the same fingerprint", () => {
    const ctxA = buildContext({
      completedWorkout: {
        id: "cw-1",
        sport: "run",
        started_at: "2026-06-10T08:00:00.000Z",
        distance_m: 10000,
        duration_s: 3000,
        summary_stats: { tss: 55, average_heartrate: 150, average_watts: 200 },
        superseded_by_id: null,
      },
      match: buildMatch({
        structure: { duration_s: 3600, load: 55, phase: "build" },
      }),
    });
    const ctxB = buildContext({
      completedWorkout: {
        // Same values, keys inserted in a different order.
        superseded_by_id: null,
        distance_m: 10000,
        sport: "run",
        id: "cw-1",
        duration_s: 3000,
        started_at: "2026-06-10T08:00:00.000Z",
        summary_stats: { average_watts: 200, tss: 55, average_heartrate: 150 },
      },
      match: buildMatch({
        structure: { phase: "build", load: 55, duration_s: 3600 },
      }),
    });
    expect(computeFingerprint(ctxA)).toBe(computeFingerprint(ctxB));
  });
});

describe("computeFingerprint — stability (non-material change, AE4)", () => {
  it("is unaffected by athleteId", () => {
    const base = computeFingerprint(buildContext());
    const changed = computeFingerprint(buildContext({ athleteId: "someone-else" }));
    expect(changed).toBe(base);
  });

  it("is unaffected by profile", () => {
    const base = computeFingerprint(buildContext());
    const changed = computeFingerprint(
      buildContext({ profile: { manual_fields: { weight_kg: 70 }, baselines: {} } })
    );
    expect(changed).toBe(base);
  });

  it("is unaffected by plan.id alone (never reaches the prompt)", () => {
    const base = computeFingerprint(
      buildContext({ plan: { id: "plan-1", event_date: "2026-12-01", goal: "marathon" } })
    );
    const changed = computeFingerprint(
      buildContext({ plan: { id: "plan-2", event_date: "2026-12-01", goal: "marathon" } })
    );
    expect(changed).toBe(base);
  });

  // DELIBERATE, PERMANENT exclusion -- see the module header. CTL/ATL/TSB are
  // an EWMA over the athlete's whole history; hashing them would mark every
  // past report stale the moment the athlete logs their next ride.
  it("is unaffected by recentLoad", () => {
    const base = computeFingerprint(buildContext());
    const changed = computeFingerprint(
      buildContext({
        recentLoad: { ...FAKE_LOAD_STATE, ctl: 42, atl: 30, tsb: 12 },
      })
    );
    expect(changed).toBe(base);
  });

  it("is unaffected by completedWorkout.started_at (a note/timestamp-style cosmetic edit)", () => {
    const base = computeFingerprint(buildContext());
    const changed = computeFingerprint(
      buildContext({
        completedWorkout: {
          ...buildContext().completedWorkout,
          started_at: "2026-06-11T09:30:00.000Z",
        },
      })
    );
    expect(changed).toBe(base);
  });

  it("is unaffected by the matched workout's non-hashed fields (scheduled_date, status, derived duration_s/load, match metadata)", () => {
    const base = computeFingerprint(buildContext());
    const changed = computeFingerprint(
      buildContext({
        match: buildMatch({
          scheduled_date: "2026-07-01",
          status: "planned",
          sport: "bike",
          duration_s: 9999, // derived field, not the raw `structure` blob
          load: 1, // derived field, not the raw `planned_load` column
          intensity_target: { kind: "zone", value: 5 },
          match: { id: "match-2", confidence: 0.1, method: "manual_user_link", matched_at: "2020-01-01T00:00:00.000Z" },
        }),
      })
    );
    expect(changed).toBe(base);
  });

  it("is unaffected by non-material fields even when the workout is unmatched (match: null)", () => {
    const base = computeFingerprint(buildContext({ match: null }));
    const changed = computeFingerprint(
      buildContext({ match: null, profile: { manual_fields: {}, baselines: {} } })
    );
    expect(changed).toBe(base);
  });
});

describe("computeFingerprint — sensitivity (each KTD4 material field)", () => {
  // plan.goal / plan.event_date: both reach the narration prompt verbatim
  // (fact-sheet.ts -> narrate.ts) and the takeaway is written TOWARD them, so
  // an athlete who changes their event has invalidated the stored advice.
  it("changes when the plan's goal changes", () => {
    const base = computeFingerprint(
      buildContext({ plan: { id: "plan-1", event_date: "2026-12-01", goal: "marathon" } })
    );
    const changed = computeFingerprint(
      buildContext({ plan: { id: "plan-1", event_date: "2026-12-01", goal: "70.3" } })
    );
    expect(changed).not.toBe(base);
  });

  it("changes when the plan's event_date changes", () => {
    const base = computeFingerprint(
      buildContext({ plan: { id: "plan-1", event_date: "2026-12-01", goal: "marathon" } })
    );
    const changed = computeFingerprint(
      buildContext({ plan: { id: "plan-1", event_date: "2027-03-14", goal: "marathon" } })
    );
    expect(changed).not.toBe(base);
  });

  it("changes when a plan appears where there was none", () => {
    const base = computeFingerprint(buildContext());
    const changed = computeFingerprint(
      buildContext({ plan: { id: "plan-1", event_date: "2026-12-01", goal: "marathon" } })
    );
    expect(changed).not.toBe(base);
  });

  it("changes when distance_m changes", () => {
    const base = computeFingerprint(buildContext());
    const changed = computeFingerprint(
      buildContext({
        completedWorkout: { ...buildContext().completedWorkout, distance_m: 10500 },
      })
    );
    expect(changed).not.toBe(base);
  });

  it("changes when duration_s changes", () => {
    const base = computeFingerprint(buildContext());
    const changed = computeFingerprint(
      buildContext({
        completedWorkout: { ...buildContext().completedWorkout, duration_s: 3100 },
      })
    );
    expect(changed).not.toBe(base);
  });

  it("changes when sport changes", () => {
    const base = computeFingerprint(buildContext());
    const changed = computeFingerprint(
      buildContext({ completedWorkout: { ...buildContext().completedWorkout, sport: "bike" } })
    );
    expect(changed).not.toBe(base);
  });

  it("changes when summary_stats changes (e.g. Strava enrichment arriving, AE5)", () => {
    const base = computeFingerprint(buildContext());
    const changed = computeFingerprint(
      buildContext({
        completedWorkout: {
          ...buildContext().completedWorkout,
          summary_stats: { tss: 55, average_heartrate: 150, laps: 4 },
        },
      })
    );
    expect(changed).not.toBe(base);
  });

  it("changes when matched_planned_workout_id changes (the match's identity)", () => {
    const base = computeFingerprint(buildContext());
    const changed = computeFingerprint(buildContext({ match: buildMatch({ id: "pw-2" }) }));
    expect(changed).not.toBe(base);
  });

  it("changes when the matched planned workout's structure (planned_structure) changes", () => {
    const base = computeFingerprint(buildContext());
    const changed = computeFingerprint(
      buildContext({ match: buildMatch({ structure: { duration_s: 4200, load: 55 } }) })
    );
    expect(changed).not.toBe(base);
  });

  it("changes when planned_load changes", () => {
    const base = computeFingerprint(buildContext());
    const changed = computeFingerprint(buildContext({ match: buildMatch({ planned_load: 70 }) }));
    expect(changed).not.toBe(base);
  });

  it("changes when superseded_by_id changes", () => {
    const base = computeFingerprint(buildContext());
    const changed = computeFingerprint(
      buildContext({
        completedWorkout: {
          ...buildContext().completedWorkout,
          superseded_by_id: "cw-strava-2",
        },
      })
    );
    expect(changed).not.toBe(base);
  });

  it("changes when a matched context becomes unmatched (match: null)", () => {
    const matched = computeFingerprint(buildContext());
    const unmatched = computeFingerprint(buildContext({ match: null }));
    expect(unmatched).not.toBe(matched);
  });
});
