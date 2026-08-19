// Tests for the deterministic period aggregation engine (U3).
//
// This is the arithmetic the whole feature rests on: every number an athlete
// reads, and every number the narration is handed, comes out of here. The
// invariant these tests exist to protect is that the engine NEVER emits a
// number it cannot justify -- no NaN from an empty period, no zero standing in
// for unknown, no percentage against a prescription that does not exist.

import { describe, expect, it } from "vitest";

import { PeriodFactsSchema } from "@da2/shared";

import { aggregatePeriod, type AggregateInput } from "../aggregate";

const LONDON = "Europe/London";

// A power-derived workout: summary_stats.tss makes the load 'power' confidence.
function ride(
  startedAt: string,
  opts: {
    durationS?: number | null;
    distanceM?: number | null;
    tss?: number;
    sport?: string;
    matched?: string | null;
  } = {},
) {
  return {
    id: `w-${startedAt}`,
    sport: opts.sport ?? "bike",
    started_at: startedAt,
    duration_s: opts.durationS === undefined ? 3600 : opts.durationS,
    distance_m: opts.distanceM === undefined ? 30000 : opts.distanceM,
    summary_stats: opts.tss === undefined ? {} : { tss: opts.tss },
    matched_planned_workout_id: opts.matched ?? null,
  };
}

function planned(
  id: string,
  opts: { durationS?: number; load?: number | null; sport?: string; structure?: Record<string, unknown> } = {},
) {
  return {
    id,
    sport: opts.sport ?? "bike",
    scheduled_date: "2026-08-12",
    planned_load: opts.load === undefined ? 60 : opts.load,
    structure: opts.structure ?? { duration_s: opts.durationS ?? 3600 },
  };
}

function input(overrides: Partial<AggregateInput> = {}): AggregateInput {
  return {
    kind: "weekly",
    periodKey: "2026-W33",
    bounds: { start: "2026-08-10", end: "2026-08-16" },
    timezone: LONDON,
    completed: [],
    planned: [],
    previous: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AE1 — the worked example from the plan
// ---------------------------------------------------------------------------

describe("AE1: 5 of 6 prescribed", () => {
  const facts = aggregatePeriod(
    input({
      planned: [
        planned("p1", { durationS: 4200, load: 63 }),
        planned("p2", { durationS: 4200, load: 63 }),
        planned("p3", { durationS: 4200, load: 63 }),
        planned("p4", { durationS: 4200, load: 63 }),
        planned("p5", { durationS: 4200, load: 64 }),
        planned("p6", { durationS: 4200, load: 64 }),
      ],
      completed: [
        ride("2026-08-10T09:00:00Z", { durationS: 4560, tss: 68, matched: "p1" }),
        ride("2026-08-11T09:00:00Z", { durationS: 4560, tss: 68, matched: "p2" }),
        ride("2026-08-12T09:00:00Z", { durationS: 4560, tss: 68, matched: "p3" }),
        ride("2026-08-13T09:00:00Z", { durationS: 4560, tss: 68, matched: "p4" }),
        ride("2026-08-15T09:00:00Z", { durationS: 4560, tss: 68, matched: "p5" }),
      ],
    }),
  );

  it("reports 5 of 6 compliance with no unplanned sessions", () => {
    expect(facts.compliance).toEqual({ prescribed: 6, completed: 5, unplanned: 0 });
  });

  it("totals the executed duration and load", () => {
    expect(facts.totals.sessions).toBe(5);
    expect(facts.totals.durationS).toBe(22800);
    expect(facts.totals.load).toBe(340);
  });

  it("scores duration under the prescription", () => {
    expect(facts.duration.status).toBe("under");
    if (facts.duration.status === "unavailable") throw new Error("unreachable");
    expect(facts.duration.prescribed).toBe(25200);
    expect(facts.duration.actual).toBe(22800);
    expect(facts.duration.deltaPct).toBeCloseTo(-9.52, 1);
  });

  it("scores load under the prescription", () => {
    expect(facts.load.status).toBe("under");
    if (facts.load.status === "unavailable") throw new Error("unreachable");
    expect(facts.load.prescribed).toBe(380);
    expect(facts.load.actual).toBe(340);
  });

  it("counts distinct active days, not sessions", () => {
    expect(facts.totals.activeDays).toBe(5);
  });

  it("produces a schema-valid fact set", () => {
    expect(PeriodFactsSchema.safeParse(facts).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AE2 — the empty period
// ---------------------------------------------------------------------------

describe("AE2: nothing completed against four prescribed", () => {
  const facts = aggregatePeriod(
    input({
      planned: [
        planned("p1", { durationS: 3600 }),
        planned("p2", { durationS: 3600 }),
        planned("p3", { durationS: 3600 }),
        planned("p4", { durationS: 3600 }),
      ],
      completed: [],
    }),
  );

  it("reports zero completed against the prescription", () => {
    expect(facts.compliance).toEqual({ prescribed: 4, completed: 0, unplanned: 0 });
  });

  it("zeroes the totals without emitting a null or NaN", () => {
    expect(facts.totals.sessions).toBe(0);
    expect(facts.totals.durationS).toBe(0);
    expect(facts.totals.load).toBe(0);
    expect(facts.totals.activeDays).toBe(0);
  });

  it("reports distance as unknown rather than zero", () => {
    expect(facts.totals.distanceM).toBeNull();
  });

  it("marks load confidence as none when nothing contributed", () => {
    expect(facts.totals.loadConfidence).toBe("none");
  });

  it("scores duration as a complete shortfall, finitely", () => {
    if (facts.duration.status === "unavailable") throw new Error("unreachable");
    expect(facts.duration.deltaPct).toBe(-100);
    expect(Number.isFinite(facts.duration.deltaPct)).toBe(true);
  });

  it("emits no sport rows rather than zero-filled ones", () => {
    expect(facts.sports).toEqual([]);
  });

  it("produces a schema-valid fact set", () => {
    expect(PeriodFactsSchema.safeParse(facts).success).toBe(true);
  });
});

describe("a period with nothing completed and nothing prescribed", () => {
  const facts = aggregatePeriod(input());

  it("keeps every ratio finite", () => {
    expect(PeriodFactsSchema.safeParse(facts).success).toBe(true);
  });

  // A percentage against a prescription of zero is not 0% and not 100% -- it
  // is undefined, and saying so is the only honest answer.
  it("marks both metrics unavailable rather than inventing a percentage", () => {
    expect(facts.duration.status).toBe("unavailable");
    expect(facts.load.status).toBe("unavailable");
  });
});

// ---------------------------------------------------------------------------
// Degradation
// ---------------------------------------------------------------------------

describe("independent metric degradation", () => {
  // KTD8-style: a structure missing a duration must not take the load
  // comparison down with it.
  it("degrades only duration when no prescribed structure carries one", () => {
    const facts = aggregatePeriod(
      input({
        planned: [planned("p1", { structure: { phase: "build" }, load: 70 })],
        completed: [ride("2026-08-12T09:00:00Z", { tss: 65, matched: "p1" })],
      }),
    );
    expect(facts.duration.status).toBe("unavailable");
    expect(facts.load.status).not.toBe("unavailable");
  });

  it("degrades only load when no prescribed workout carries one", () => {
    const facts = aggregatePeriod(
      input({
        planned: [planned("p1", { durationS: 3600, load: null, structure: { duration_s: 3600 } })],
        completed: [ride("2026-08-12T09:00:00Z", { tss: 65, matched: "p1" })],
      }),
    );
    expect(facts.load.status).toBe("unavailable");
    expect(facts.duration.status).not.toBe("unavailable");
  });

  // The production key-drift case: minutes-spelled durations must count.
  it.each([
    ["est_duration_min", { est_duration_min: 60 }],
    ["total_duration_min", { total_duration_min: 60 }],
    ["duration_s", { duration_s: 3600 }],
  ])("reads a prescribed duration spelled as %s", (_label, structure) => {
    const facts = aggregatePeriod(
      input({
        planned: [planned("p1", { structure })],
        completed: [ride("2026-08-12T09:00:00Z", { durationS: 3600, tss: 60, matched: "p1" })],
      }),
    );
    if (facts.duration.status === "unavailable") throw new Error("duration should resolve");
    expect(facts.duration.prescribed).toBe(3600);
  });
});

// ---------------------------------------------------------------------------
// Load confidence
// ---------------------------------------------------------------------------

describe("load confidence", () => {
  it("is power when every session carried real load data", () => {
    const facts = aggregatePeriod(
      input({
        completed: [
          ride("2026-08-12T09:00:00Z", { tss: 60 }),
          ride("2026-08-13T09:00:00Z", { tss: 50 }),
        ],
      }),
    );
    expect(facts.totals.loadConfidence).toBe("power");
  });

  it("is duration when every session fell back to the proxy", () => {
    const facts = aggregatePeriod(
      input({
        completed: [
          ride("2026-08-12T09:00:00Z", { durationS: 3600 }),
          ride("2026-08-13T09:00:00Z", { durationS: 1800 }),
        ],
      }),
    );
    expect(facts.totals.loadConfidence).toBe("duration");
  });

  it("is mixed when the period blends both", () => {
    const facts = aggregatePeriod(
      input({
        completed: [
          ride("2026-08-12T09:00:00Z", { tss: 60 }),
          ride("2026-08-13T09:00:00Z", { durationS: 3600 }),
        ],
      }),
    );
    expect(facts.totals.loadConfidence).toBe("mixed");
  });
});

// ---------------------------------------------------------------------------
// Sport rollup
// ---------------------------------------------------------------------------

describe("sport rollup", () => {
  const facts = aggregatePeriod(
    input({
      completed: [
        ride("2026-08-12T09:00:00Z", { sport: "run", durationS: 3600, distanceM: 10000, tss: 70 }),
        ride("2026-08-13T09:00:00Z", { sport: "run", durationS: 1800, distanceM: 5000, tss: 35 }),
        ride("2026-08-14T09:00:00Z", { sport: "bike", durationS: 7200, distanceM: 60000, tss: 120 }),
      ],
    }),
  );

  it("groups sessions by sport", () => {
    const run = facts.sports.find((s) => s.sport === "run");
    expect(run).toMatchObject({ sessions: 2, durationS: 5400, distanceM: 15000, load: 105 });
  });

  it("omits sports the athlete did not touch", () => {
    expect(facts.sports.map((s) => s.sport).sort()).toEqual(["bike", "run"]);
  });

  it("orders sports by load, heaviest first", () => {
    expect(facts.sports[0]?.sport).toBe("bike");
  });

  it("reports a sport's distance as null when no session recorded one", () => {
    const swimFacts = aggregatePeriod(
      input({
        completed: [ride("2026-08-12T09:00:00Z", { sport: "swim", distanceM: null, tss: 40 })],
      }),
    );
    expect(swimFacts.sports[0]?.distanceM).toBeNull();
  });

  it("maps an unrecognized sport to 'other' rather than failing the period", () => {
    const facts2 = aggregatePeriod(
      input({ completed: [ride("2026-08-12T09:00:00Z", { sport: "curling", tss: 10 })] }),
    );
    expect(facts2.sports[0]?.sport).toBe("other");
    expect(PeriodFactsSchema.safeParse(facts2).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Compliance edge cases
// ---------------------------------------------------------------------------

describe("compliance", () => {
  it("counts unplanned sessions separately from prescribed ones", () => {
    const facts = aggregatePeriod(
      input({
        planned: [planned("p1"), planned("p2")],
        completed: [
          ride("2026-08-12T09:00:00Z", { matched: "p1", tss: 60 }),
          ride("2026-08-13T09:00:00Z", { matched: null, tss: 30 }),
          ride("2026-08-14T09:00:00Z", { matched: null, tss: 30 }),
        ],
      }),
    );
    expect(facts.compliance).toEqual({ prescribed: 2, completed: 1, unplanned: 2 });
  });

  // Two completed sessions matched to the SAME prescription must not read as
  // two of two prescribed done.
  it("counts a prescribed session once even if two workouts match it", () => {
    const facts = aggregatePeriod(
      input({
        planned: [planned("p1"), planned("p2")],
        completed: [
          ride("2026-08-12T09:00:00Z", { matched: "p1", tss: 30 }),
          ride("2026-08-12T18:00:00Z", { matched: "p1", tss: 30 }),
        ],
      }),
    );
    expect(facts.compliance.completed).toBe(1);
  });

  // A match pointing outside the period must not inflate in-period compliance.
  it("ignores a match to a prescription outside this period", () => {
    const facts = aggregatePeriod(
      input({
        planned: [planned("p1")],
        completed: [ride("2026-08-12T09:00:00Z", { matched: "p-elsewhere", tss: 30 })],
      }),
    );
    expect(facts.compliance).toEqual({ prescribed: 1, completed: 0, unplanned: 1 });
  });
});

// ---------------------------------------------------------------------------
// Active days (timezone-sensitive)
// ---------------------------------------------------------------------------

describe("active days", () => {
  it("counts two sessions on the same local day once", () => {
    const facts = aggregatePeriod(
      input({
        completed: [
          ride("2026-08-12T06:00:00Z", { tss: 30 }),
          ride("2026-08-12T18:00:00Z", { tss: 30 }),
        ],
      }),
    );
    expect(facts.totals.activeDays).toBe(1);
  });

  // The same two instants straddle local midnight in London but sit inside one
  // afternoon in Los Angeles -- so the SAME data is a two-day week for one
  // athlete and a one-day week for another. A UTC-based day count would give
  // both of them 1 and be wrong for the Londoner.
  it("resolves the day in the athlete's timezone, not UTC", () => {
    const completed = [
      ride("2026-08-12T22:00:00Z", { tss: 30 }), // 23:00 12th BST / 15:00 12th PDT
      ride("2026-08-12T23:30:00Z", { tss: 30 }), // 00:30 13th BST / 16:30 12th PDT
    ];
    const london = aggregatePeriod(input({ timezone: LONDON, completed }));
    const la = aggregatePeriod(input({ timezone: "America/Los_Angeles", completed }));
    expect(london.totals.activeDays).toBe(2);
    expect(la.totals.activeDays).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Period-over-period comparison
// ---------------------------------------------------------------------------

describe("comparison", () => {
  it("is absent when there is no prior period", () => {
    const facts = aggregatePeriod(input({ previous: null }));
    expect(facts.comparison).toEqual({ available: false });
  });

  it("computes deltas against the prior period", () => {
    const facts = aggregatePeriod(
      input({
        completed: [
          ride("2026-08-12T09:00:00Z", { durationS: 3600, tss: 60 }),
          ride("2026-08-13T09:00:00Z", { durationS: 3600, tss: 60 }),
        ],
        previous: {
          key: "2026-W32",
          completed: [ride("2026-08-05T09:00:00Z", { durationS: 3600, tss: 60 })],
        },
      }),
    );
    if (!facts.comparison.available) throw new Error("comparison should be available");
    expect(facts.comparison.previousKey).toBe("2026-W32");
    expect(facts.comparison.sessionsDeltaPct).toBe(100);
    expect(facts.comparison.loadDeltaPct).toBe(100);
    expect(facts.comparison.activeDaysDelta).toBe(1);
  });

  // An empty prior period is a real thing (an athlete returning from a break).
  // The delta against zero is not expressible as a percentage.
  it("keeps deltas finite when the prior period was empty", () => {
    const facts = aggregatePeriod(
      input({
        completed: [ride("2026-08-12T09:00:00Z", { tss: 60 })],
        previous: { key: "2026-W32", completed: [] },
      }),
    );
    expect(PeriodFactsSchema.safeParse(facts).success).toBe(true);
    if (!facts.comparison.available) throw new Error("comparison should be available");
    expect(Number.isFinite(facts.comparison.loadDeltaPct)).toBe(true);
  });

  it("reports a decline when the period was lighter than the last", () => {
    const facts = aggregatePeriod(
      input({
        completed: [ride("2026-08-12T09:00:00Z", { durationS: 1800, tss: 30 })],
        previous: {
          key: "2026-W32",
          completed: [ride("2026-08-05T09:00:00Z", { durationS: 3600, tss: 60 })],
        },
      }),
    );
    if (!facts.comparison.available) throw new Error("comparison should be available");
    expect(facts.comparison.loadDeltaPct).toBe(-50);
    expect(facts.comparison.durationDeltaPct).toBe(-50);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("produces identical facts regardless of input row order", () => {
    const completed = [
      ride("2026-08-12T09:00:00Z", { sport: "run", tss: 60 }),
      ride("2026-08-13T09:00:00Z", { sport: "bike", tss: 40 }),
      ride("2026-08-14T09:00:00Z", { sport: "swim", tss: 40, distanceM: 2000 }),
    ];
    const a = aggregatePeriod(input({ completed }));
    const b = aggregatePeriod(input({ completed: [...completed].reverse() }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("carries the period identity through to the facts", () => {
    const facts = aggregatePeriod(input({ kind: "monthly", periodKey: "2026-08" }));
    expect(facts.kind).toBe("monthly");
    expect(facts.periodKey).toBe("2026-08");
  });
});
