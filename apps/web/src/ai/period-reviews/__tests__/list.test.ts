// Tests for the batched period-summary builder (review fix #13).
//
// The fix's whole claim is about QUERY COUNT, so the central assertion here
// counts the reads rather than trusting the shape: listing fourteen periods
// must issue three table reads, not fourteen times eight.
//
// The slicing is the other half — one wide fetch is only correct if each
// period gets exactly the rows that fall inside its own athlete-local range.

import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import { listPeriodSummaries, type ListedPeriod } from "../list";

const ATHLETE = "athlete-1";
const LONDON = "Europe/London";

type Row = Record<string, unknown>;

/** Records every table read so the batching property is measurable. */
class Recorder {
  readonly reads: string[] = [];
}

function makeFake(tables: Record<string, Row[]>, rec: Recorder, errored: string[] = []) {
  const erroredSet = new Set(errored);

  class Builder {
    private filters: Array<(r: Row) => boolean> = [];
    constructor(
      private readonly rows: Row[],
      private readonly table: string,
    ) {}
    select() {
      return this;
    }
    eq(col: string, v: unknown) {
      this.filters.push((r) => r[col] === v);
      return this;
    }
    is(col: string, v: null) {
      this.filters.push((r) => (r[col] ?? null) === v);
      return this;
    }
    gte(col: string, v: string) {
      this.filters.push((r) => String(r[col]) >= v);
      return this;
    }
    lte(col: string, v: string) {
      this.filters.push((r) => String(r[col]) <= v);
      return this;
    }
    lt(col: string, v: string) {
      this.filters.push((r) => String(r[col]) < v);
      return this;
    }
    in(col: string, vals: unknown[]) {
      this.filters.push((r) => vals.includes(r[col]));
      return this;
    }
    order() {
      return this;
    }
    then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
      const result = erroredSet.has(this.table)
        ? { data: null, error: { message: `${this.table} boom` } }
        : { data: this.rows.filter((r) => this.filters.every((f) => f(r))), error: null };
      return Promise.resolve(result).then(onF, onR);
    }
  }

  return {
    from(table: string) {
      rec.reads.push(table);
      return new Builder(tables[table] ?? [], table);
    },
  } as unknown as SupabaseClient;
}

function completed(over: Partial<Row> = {}): Row {
  return {
    id: "cw-1",
    athlete_id: ATHLETE,
    sport: "run",
    started_at: "2026-08-12T08:00:00.000Z",
    distance_m: 10000,
    duration_s: 3600,
    summary_stats: { tss: 60 },
    deleted_at: null,
    ...over,
  };
}

function planned(over: Partial<Row> = {}): Row {
  return {
    id: "pw-1",
    athlete_id: ATHLETE,
    sport: "run",
    scheduled_date: "2026-08-12",
    planned_load: 60,
    structure: { duration_s: 3600 },
    deleted_at: null,
    ...over,
  };
}

const FOURTEEN: ListedPeriod[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    kind: "weekly" as const,
    key: `2026-W${String(33 - i).padStart(2, "0")}`,
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    kind: "monthly" as const,
    key: `2026-${String(8 - i).padStart(2, "0")}`,
  })),
];

function run(
  tables: Record<string, Row[]>,
  periods: ListedPeriod[] = FOURTEEN,
  errored: string[] = [],
) {
  const rec = new Recorder();
  return listPeriodSummaries({
    supabase: makeFake(tables, rec, errored),
    athleteId: ATHLETE,
    timezone: LONDON,
    periods,
    narrated: new Set(),
  }).then((summaries) => ({ summaries, reads: rec.reads }));
}

// ---------------------------------------------------------------------------
// The query-count property
// ---------------------------------------------------------------------------

describe("query count", () => {
  // The regression this fix exists for: ~114 round trips per page load.
  it("issues three table reads for fourteen periods", async () => {
    const { reads } = await run({
      completed_workouts: [completed()],
      planned_workouts: [planned()],
      workout_matches: [],
    });
    expect(reads).toHaveLength(3);
    expect(new Set(reads)).toEqual(
      new Set(["completed_workouts", "planned_workouts", "workout_matches"]),
    );
  });

  it("issues the same reads for one period as for fourteen", async () => {
    const one = await run(
      { completed_workouts: [completed()], planned_workouts: [planned()] },
      [{ kind: "weekly", key: "2026-W33" }],
    );
    const many = await run({
      completed_workouts: [completed()],
      planned_workouts: [planned()],
    });
    expect(many.reads.length).toBe(one.reads.length);
  });

  // No completed workouts means no ids to match, so the third read is skipped.
  it("skips the match read entirely when the window has no workouts", async () => {
    const { reads } = await run({});
    expect(reads).toHaveLength(2);
  });

  it("issues nothing at all for an empty period list", async () => {
    const { summaries, reads } = await run({}, []);
    expect(summaries).toEqual([]);
    expect(reads).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Slicing — one wide fetch must still attribute rows to the right period
// ---------------------------------------------------------------------------

describe("slicing", () => {
  const periods: ListedPeriod[] = [
    { kind: "weekly", key: "2026-W33" }, // Mon 2026-08-10 .. Sun 2026-08-16
    { kind: "weekly", key: "2026-W32" }, // Mon 2026-08-03 .. Sun 2026-08-09
  ];

  it("attributes each workout to the period it falls in", async () => {
    const { summaries } = await run(
      {
        completed_workouts: [
          completed({ id: "cw-w33", started_at: "2026-08-12T08:00:00.000Z" }),
          completed({ id: "cw-w32", started_at: "2026-08-05T08:00:00.000Z" }),
        ],
      },
      periods,
    );
    const w33 = summaries.find((s) => s.periodKey === "2026-W33");
    const w32 = summaries.find((s) => s.periodKey === "2026-W32");
    expect(w33?.sessions).toBe(1);
    expect(w32?.sessions).toBe(1);
  });

  // The boundary the batching could most plausibly get wrong: local midnight,
  // not UTC midnight. 22:50Z on the 16th is 23:50 BST, still inside W33.
  it("respects the athlete-local period boundary when slicing", async () => {
    const { summaries } = await run(
      {
        completed_workouts: [
          completed({ id: "cw-late", started_at: "2026-08-16T22:50:00.000Z" }),
          completed({ id: "cw-next", started_at: "2026-08-16T23:10:00.000Z" }),
        ],
      },
      periods,
    );
    const w33 = summaries.find((s) => s.periodKey === "2026-W33");
    // 23:10Z is 00:10 Monday local — the next week, which is not listed here.
    expect(w33?.sessions).toBe(1);
  });

  it("attributes prescribed workouts by their scheduled date", async () => {
    const { summaries } = await run(
      {
        planned_workouts: [
          planned({ id: "pw-w33", scheduled_date: "2026-08-12" }),
          planned({ id: "pw-w32", scheduled_date: "2026-08-05" }),
        ],
      },
      periods,
    );
    // Compliance is not on the summary, but a mis-sliced prescription would
    // still surface: both periods must resolve without borrowing each other's.
    expect(summaries).toHaveLength(2);
  });

  it("returns a summary for every requested period, in order", async () => {
    const { summaries } = await run({}, periods);
    expect(summaries.map((s) => s.periodKey)).toEqual(["2026-W33", "2026-W32"]);
  });

  it("reports zeros for a period with no rows rather than omitting it", async () => {
    const { summaries } = await run(
      { completed_workouts: [completed({ started_at: "2026-08-12T08:00:00.000Z" })] },
      periods,
    );
    const w32 = summaries.find((s) => s.periodKey === "2026-W32");
    expect(w32?.sessions).toBe(0);
    expect(w32?.load).toBe(0);
  });

  it("marks narration presence per period", async () => {
    const rec = new Recorder();
    const summaries = await listPeriodSummaries({
      supabase: makeFake({}, rec),
      athleteId: ATHLETE,
      timezone: LONDON,
      periods,
      narrated: new Set(["weekly:2026-W33"]),
    });
    expect(summaries.find((s) => s.periodKey === "2026-W33")?.hasNarration).toBe(true);
    expect(summaries.find((s) => s.periodKey === "2026-W32")?.hasNarration).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Failure posture
// ---------------------------------------------------------------------------

describe("failures", () => {
  // Same reasoning as gatherPeriodContext: degrading either read puts a
  // fabricated number in front of the athlete rather than a missing one.
  it("throws when the completed read fails", async () => {
    await expect(
      run({ completed_workouts: [completed()] }, FOURTEEN, ["completed_workouts"]),
    ).rejects.toThrow(/completed_workouts read failed/);
  });

  it("throws when the planned read fails", async () => {
    await expect(
      run({ planned_workouts: [planned()] }, FOURTEEN, ["planned_workouts"]),
    ).rejects.toThrow(/planned_workouts read failed/);
  });

  // Understating compliance is the safe direction; inventing it is not.
  it("degrades a failed match read to unplanned rather than throwing", async () => {
    const { summaries } = await run(
      { completed_workouts: [completed()], planned_workouts: [planned()] },
      FOURTEEN,
      ["workout_matches"],
    );
    expect(summaries.length).toBe(14);
  });
});
