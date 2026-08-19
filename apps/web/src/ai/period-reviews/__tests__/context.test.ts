// Unit tests for gatherPeriodContext (U4).
//
// Supabase is faked with a small in-memory query builder keyed by table name --
// no real DB. This mirrors apps/web/src/ai/reports/__tests__/context.test.ts's
// approach, extended with the chain methods this module uses (.in, .lte,
// .order, .limit).
//
// The fake deliberately does NOT model RLS. What is under test is context.ts's
// OWN explicit athlete filters, which are the enforcement layer in the
// service-role paths (the API route and, more importantly, the scheduled
// delivery worker, which has no user session at all).

import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import { InvalidPeriodKeyError } from "../calendar";
import { gatherPeriodContext } from "../context";

// ---------------------------------------------------------------------------
// Fake Supabase client
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type QueryResult<T> = { data: T | null; error: { message: string } | null };

class QueryBuilder {
  private filters: Array<(row: Row) => boolean> = [];
  private orderCol: string | null = null;
  private limitN: number | null = null;

  constructor(
    private readonly rows: Row[],
    private readonly erroredTables: ReadonlySet<string>,
    private readonly table: string,
  ) {}

  select(_cols?: string): this {
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }

  is(col: string, val: null): this {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }

  gte(col: string, val: string): this {
    this.filters.push((r) => String(r[col]) >= val);
    return this;
  }

  lte(col: string, val: string): this {
    this.filters.push((r) => String(r[col]) <= val);
    return this;
  }

  lt(col: string, val: string): this {
    this.filters.push((r) => String(r[col]) < val);
    return this;
  }

  in(col: string, vals: unknown[]): this {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }

  order(col: string): this {
    this.orderCol = col;
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  private matched(): Row[] {
    let out = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      const col = this.orderCol;
      out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
    }
    if (this.limitN != null) out = out.slice(0, this.limitN);
    return out;
  }

  async maybeSingle(): Promise<QueryResult<Row>> {
    if (this.erroredTables.has(this.table)) {
      return { data: null, error: { message: `${this.table} boom` } };
    }
    return { data: this.matched()[0] ?? null, error: null };
  }

  then<TResult1 = QueryResult<Row[]>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<Row[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const result: QueryResult<Row[]> = this.erroredTables.has(this.table)
      ? { data: null, error: { message: `${this.table} boom` } }
      : { data: this.matched(), error: null };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

function makeFakeSupabase(tables: Record<string, Row[]>, errored: string[] = []): SupabaseClient {
  const erroredSet = new Set(errored);
  return {
    from(table: string) {
      return new QueryBuilder(tables[table] ?? [], erroredSet, table);
    },
  } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Fixtures — 2026-W33 is Mon 2026-08-10 .. Sun 2026-08-16 (London)
// ---------------------------------------------------------------------------

const ATHLETE = "athlete-1";
const STRANGER = "athlete-2";
const LONDON = "Europe/London";

function completed(over: Partial<Row> = {}): Row {
  return {
    id: "cw-1",
    athlete_id: ATHLETE,
    sport: "run",
    started_at: "2026-08-12T08:00:00.000Z",
    distance_m: 10000,
    duration_s: 3000,
    summary_stats: { tss: 55 },
    deleted_at: null,
    ...over,
  };
}

function plannedRow(over: Partial<Row> = {}): Row {
  return {
    id: "pw-1",
    athlete_id: ATHLETE,
    sport: "run",
    scheduled_date: "2026-08-12",
    planned_load: 55,
    structure: { duration_s: 3600 },
    deleted_at: null,
    ...over,
  };
}

function matchRow(over: Partial<Row> = {}): Row {
  return {
    id: "m-1",
    completed_workout_id: "cw-1",
    planned_workout_id: "pw-1",
    confidence: 0.9,
    method: "auto_time",
    matched_at: "2026-08-12T09:00:00.000Z",
    deleted_at: null,
    ...over,
  };
}

function gather(tables: Record<string, Row[]>, errored: string[] = [], over: Partial<Parameters<typeof gatherPeriodContext>[0]> = {}) {
  return gatherPeriodContext({
    supabase: makeFakeSupabase(tables, errored),
    athleteId: ATHLETE,
    kind: "weekly",
    periodKey: "2026-W33",
    timezone: LONDON,
    ...over,
  });
}

// ---------------------------------------------------------------------------

describe("gatherPeriodContext", () => {
  it("returns the period's completed workouts with their matches resolved", async () => {
    const ctx = await gather({
      completed_workouts: [completed()],
      planned_workouts: [plannedRow()],
      workout_matches: [matchRow()],
    });

    expect(ctx.completed).toHaveLength(1);
    expect(ctx.completed[0].matched_planned_workout_id).toBe("pw-1");
    expect(ctx.planned).toHaveLength(1);
  });

  // R5: an empty period is a valid context, not a not-found. This is the
  // single most important difference from the per-workout report's contract.
  it("returns a valid empty context for a period with no data", async () => {
    const ctx = await gather({});
    expect(ctx.completed).toEqual([]);
    expect(ctx.planned).toEqual([]);
    expect(ctx.bounds).toEqual({ start: "2026-08-10", end: "2026-08-16" });
  });

  it("throws on a malformed period key before touching the database", async () => {
    await expect(gather({}, [], { periodKey: "last-week" })).rejects.toBeInstanceOf(
      InvalidPeriodKeyError,
    );
  });

  it("throws when the key does not match the kind", async () => {
    await expect(gather({}, [], { periodKey: "2026-08" })).rejects.toBeInstanceOf(
      InvalidPeriodKeyError,
    );
  });
});

// ---------------------------------------------------------------------------
// Athlete scoping — the enforcement layer in the worker path
// ---------------------------------------------------------------------------

describe("athlete scoping", () => {
  it("excludes another athlete's completed workouts", async () => {
    const ctx = await gather({
      completed_workouts: [completed(), completed({ id: "cw-x", athlete_id: STRANGER })],
    });
    expect(ctx.completed.map((w) => w.id)).toEqual(["cw-1"]);
  });

  it("excludes another athlete's planned workouts", async () => {
    const ctx = await gather({
      planned_workouts: [plannedRow(), plannedRow({ id: "pw-x", athlete_id: STRANGER })],
    });
    expect(ctx.planned.map((p) => p.id)).toEqual(["pw-1"]);
  });

  it("excludes another athlete's plan and profile", async () => {
    const ctx = await gather({
      plans: [
        {
          id: "plan-x",
          athlete_id: STRANGER,
          status: "active",
          event_date: "2026-10-01",
          event_type: "marathon",
          deleted_at: null,
        },
      ],
      athlete_profiles: [{ user_id: STRANGER, manual_fields: { ftp: 250 }, baselines: {} }],
    });
    expect(ctx.plan).toBeNull();
    expect(ctx.profile).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Soft deletes and period boundaries
// ---------------------------------------------------------------------------

describe("row filtering", () => {
  it("excludes soft-deleted completed workouts", async () => {
    const ctx = await gather({
      completed_workouts: [
        completed(),
        completed({ id: "cw-del", deleted_at: "2026-08-13T00:00:00.000Z" }),
      ],
    });
    expect(ctx.completed.map((w) => w.id)).toEqual(["cw-1"]);
  });

  it("excludes soft-deleted planned workouts", async () => {
    const ctx = await gather({
      planned_workouts: [
        plannedRow(),
        plannedRow({ id: "pw-del", deleted_at: "2026-08-13T00:00:00.000Z" }),
      ],
    });
    expect(ctx.planned.map((p) => p.id)).toEqual(["pw-1"]);
  });

  it("excludes a workout that falls outside the local period", async () => {
    const ctx = await gather({
      completed_workouts: [
        completed(),
        // Mon 2026-08-17 00:10 London = 23:10Z on the 16th — next week.
        completed({ id: "cw-next", started_at: "2026-08-16T23:10:00.000Z" }),
      ],
    });
    expect(ctx.completed.map((w) => w.id)).toEqual(["cw-1"]);
  });

  it("includes a workout at 23:50 local on the period's last day", async () => {
    const ctx = await gather({
      completed_workouts: [completed({ id: "cw-late", started_at: "2026-08-16T22:50:00.000Z" })],
    });
    expect(ctx.completed.map((w) => w.id)).toEqual(["cw-late"]);
  });

  it("ignores a soft-deleted match, leaving the workout unplanned", async () => {
    const ctx = await gather({
      completed_workouts: [completed()],
      workout_matches: [matchRow({ deleted_at: "2026-08-13T00:00:00.000Z" })],
    });
    expect(ctx.completed[0].matched_planned_workout_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Prior-period presence — the distinction that drives AE-relevant behaviour
// ---------------------------------------------------------------------------

describe("previous period", () => {
  // A brand-new athlete's first-ever week has nothing to compare against.
  it("is null when the athlete has no history before this period", async () => {
    const ctx = await gather({ completed_workouts: [completed()] });
    expect(ctx.previous).toBeNull();
  });

  // Present-but-empty is a real -100%, and must not be conflated with absent.
  it("is present but empty when the athlete trained before but not last period", async () => {
    const ctx = await gather({
      completed_workouts: [
        completed(),
        completed({ id: "cw-old", started_at: "2026-05-01T08:00:00.000Z" }),
      ],
    });
    expect(ctx.previous).not.toBeNull();
    expect(ctx.previous?.key).toBe("2026-W32");
    expect(ctx.previous?.completed).toEqual([]);
  });

  it("carries the prior period's workouts when they exist", async () => {
    const ctx = await gather({
      completed_workouts: [
        completed(),
        completed({ id: "cw-prev", started_at: "2026-08-05T08:00:00.000Z" }),
      ],
    });
    expect(ctx.previous?.completed.map((w) => w.id)).toEqual(["cw-prev"]);
  });

  it("does not treat another athlete's history as this athlete's", async () => {
    const ctx = await gather({
      completed_workouts: [
        completed(),
        completed({ id: "cw-old-x", athlete_id: STRANGER, started_at: "2026-05-01T08:00:00.000Z" }),
      ],
    });
    expect(ctx.previous).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Determinism and degradation
// ---------------------------------------------------------------------------

describe("determinism", () => {
  // The fingerprint hashes an ordered projection of these rows; an unordered
  // read would hash differently for identical data and mark reviews stale at
  // random.
  it("returns completed workouts in a stable id order", async () => {
    const ctx = await gather({
      completed_workouts: [
        completed({ id: "cw-3" }),
        completed({ id: "cw-1" }),
        completed({ id: "cw-2" }),
      ],
    });
    expect(ctx.completed.map((w) => w.id)).toEqual(["cw-1", "cw-2", "cw-3"]);
  });
});

describe("degradation", () => {
  it("degrades planned workouts to empty when that read fails", async () => {
    const ctx = await gather({ completed_workouts: [completed()] }, ["planned_workouts"]);
    expect(ctx.planned).toEqual([]);
    expect(ctx.completed).toHaveLength(1);
  });

  it("degrades the plan to null when that read fails", async () => {
    const ctx = await gather({ completed_workouts: [completed()] }, ["plans"]);
    expect(ctx.plan).toBeNull();
  });

  it("degrades the profile to null when that read fails", async () => {
    const ctx = await gather({ completed_workouts: [completed()] }, ["athlete_profiles"]);
    expect(ctx.profile).toBeNull();
  });

  // Understating compliance is the safe direction: every session reads as
  // unplanned rather than the review inventing plan adherence.
  it("degrades matches to unplanned when that read fails", async () => {
    const ctx = await gather(
      { completed_workouts: [completed()], workout_matches: [matchRow()] },
      ["workout_matches"],
    );
    expect(ctx.completed[0].matched_planned_workout_id).toBeNull();
  });

  it("propagates a failed completed_workouts read rather than reporting an empty week", async () => {
    await expect(gather({ completed_workouts: [completed()] }, ["completed_workouts"])).rejects.toThrow(
      /completed_workouts read failed/,
    );
  });
});

describe("plan context", () => {
  it("sources the goal from plans.event_type", async () => {
    const ctx = await gather({
      plans: [
        {
          id: "plan-1",
          athlete_id: ATHLETE,
          status: "active",
          event_date: "2026-10-01",
          event_type: "marathon",
          deleted_at: null,
        },
      ],
    });
    expect(ctx.plan).toEqual({ id: "plan-1", event_date: "2026-10-01", goal: "marathon" });
  });

  it("ignores a non-active plan", async () => {
    const ctx = await gather({
      plans: [
        {
          id: "plan-1",
          athlete_id: ATHLETE,
          status: "archived",
          event_date: null,
          event_type: null,
          deleted_at: null,
        },
      ],
    });
    expect(ctx.plan).toBeNull();
  });
});
