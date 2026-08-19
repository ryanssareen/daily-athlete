// Unit tests for gatherReportContext (plan Unit U4).
//
// Supabase access is faked with a tiny in-memory query builder keyed by
// table name -- no real DB, no `supabase start`. The fake supports exactly
// the chain shapes context.ts issues: `.select().eq()...maybeSingle()` for
// single-row reads and `.select().eq()...` awaited directly (a thenable) for
// the array reads (workout_matches, the recent-load history window).
//
// This module runs under a user-JWT client per AGENTS.md's RLS posture, so
// the fake does not model RLS itself -- context.ts's OWN explicit
// `.eq("athlete_id", ...)` / `.eq("id", ...)` filters are what's under test
// here (a real Postgres RLS policy would do this scoping for us in
// production; the fake exercises the same query shape).

import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CompletedWorkoutNotFoundError,
  gatherReportContext,
  pickBestMatch,
} from "../context";

// ---------------------------------------------------------------------------
// Fake Supabase client
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type QueryResult<T> = { data: T | null; error: { message: string } | null };

class QueryBuilder {
  private filters: Array<(row: Row) => boolean> = [];

  constructor(
    private readonly rows: Row[],
    private readonly erroredTables: ReadonlySet<string>,
    private readonly table: string
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

  lt(col: string, val: string): this {
    this.filters.push((r) => String(r[col]) < val);
    return this;
  }

  private matched(): Row[] {
    return this.rows.filter((r) => this.filters.every((f) => f(r)));
  }

  async maybeSingle(): Promise<QueryResult<Row>> {
    if (this.erroredTables.has(this.table)) {
      return { data: null, error: { message: `${this.table} boom` } };
    }
    const m = this.matched();
    return { data: m[0] ?? null, error: null };
  }

  // Array reads (no .maybeSingle()) are awaited directly -- make the builder
  // itself thenable, mirroring the real supabase-js query-builder contract.
  then<TResult1 = QueryResult<Row[]>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<Row[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const result: QueryResult<Row[]> = this.erroredTables.has(this.table)
      ? { data: null, error: { message: `${this.table} boom` } }
      : { data: this.matched(), error: null };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

function makeFakeSupabase(
  tables: Record<string, Row[]>,
  erroredTables: string[] = []
): SupabaseClient {
  const errored = new Set(erroredTables);
  return {
    from(table: string) {
      return new QueryBuilder(tables[table] ?? [], errored, table);
    },
  } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ATHLETE_ID = "athlete-1";
const COMPLETED_ID = "cw-1";

function completedRow(over: Partial<Row> = {}): Row {
  return {
    id: COMPLETED_ID,
    athlete_id: ATHLETE_ID,
    sport: "run",
    started_at: "2026-06-10T08:00:00.000Z",
    distance_m: 10000,
    duration_s: 3000,
    summary_stats: { tss: 55 },
    superseded_by_id: null,
    deleted_at: null,
    ...over,
  };
}

function plannedRow(over: Partial<Row> = {}): Row {
  return {
    id: "pw-1",
    athlete_id: ATHLETE_ID,
    scheduled_date: "2026-06-10",
    sport: "run",
    structure: { duration_s: 3600, load: 55, intensity_target: { kind: "zone", value: 3 } },
    planned_load: 55,
    status: "completed",
    deleted_at: null,
    ...over,
  };
}

function matchRow(over: Partial<Row> = {}): Row {
  return {
    id: "match-1",
    planned_workout_id: "pw-1",
    completed_workout_id: COMPLETED_ID,
    confidence: 0.9,
    method: "auto_same_day_sport",
    matched_at: "2026-06-10T09:00:00.000Z",
    deleted_at: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// gatherReportContext
// ---------------------------------------------------------------------------

describe("gatherReportContext", () => {
  it("throws CompletedWorkoutNotFoundError when the completed workout is not visible", async () => {
    const supabase = makeFakeSupabase({ completed_workouts: [] });
    await expect(
      gatherReportContext({ supabase, athleteId: ATHLETE_ID, completedWorkoutId: COMPLETED_ID })
    ).rejects.toThrow(CompletedWorkoutNotFoundError);
  });

  it("resolves the matched planned_workouts row for a single active match", async () => {
    const supabase = makeFakeSupabase({
      completed_workouts: [completedRow()],
      workout_matches: [matchRow()],
      planned_workouts: [plannedRow()],
    });
    const ctx = await gatherReportContext({
      supabase,
      athleteId: ATHLETE_ID,
      completedWorkoutId: COMPLETED_ID,
    });

    expect(ctx.match).not.toBeNull();
    expect(ctx.match?.id).toBe("pw-1");
    expect(ctx.match?.duration_s).toBe(3600);
    expect(ctx.match?.load).toBe(55);
    expect(ctx.match?.planned_load).toBe(55);
    expect(ctx.match?.intensity_target).toEqual({ kind: "zone", value: 3 });
    expect(ctx.match?.match.confidence).toBe(0.9);
  });

  it("yields match: null when the only match is soft-deleted", async () => {
    const supabase = makeFakeSupabase({
      completed_workouts: [completedRow()],
      workout_matches: [matchRow({ deleted_at: "2026-06-11T00:00:00.000Z" })],
      planned_workouts: [plannedRow()],
    });
    const ctx = await gatherReportContext({
      supabase,
      athleteId: ATHLETE_ID,
      completedWorkoutId: COMPLETED_ID,
    });
    expect(ctx.match).toBeNull();
  });

  it("picks the higher-confidence match deterministically when two live matches exist", async () => {
    const supabase = makeFakeSupabase({
      completed_workouts: [completedRow()],
      workout_matches: [
        matchRow({ id: "match-low", planned_workout_id: "pw-1", confidence: 0.4 }),
        matchRow({ id: "match-high", planned_workout_id: "pw-2", confidence: 0.9 }),
      ],
      planned_workouts: [
        plannedRow({ id: "pw-1", planned_load: 10 }),
        plannedRow({ id: "pw-2", planned_load: 99 }),
      ],
    });
    const ctx = await gatherReportContext({
      supabase,
      athleteId: ATHLETE_ID,
      completedWorkoutId: COMPLETED_ID,
    });
    expect(ctx.match?.id).toBe("pw-2");
    expect(ctx.match?.match.id).toBe("match-high");
  });

  it("reflects a superseded manual completed workout", async () => {
    const supabase = makeFakeSupabase({
      completed_workouts: [completedRow({ superseded_by_id: "cw-strava-2" })],
      workout_matches: [],
    });
    const ctx = await gatherReportContext({
      supabase,
      athleteId: ATHLETE_ID,
      completedWorkoutId: COMPLETED_ID,
    });
    expect(ctx.completedWorkout.superseded_by_id).toBe("cw-strava-2");
    expect(ctx.match).toBeNull();
  });

  it("returns profile: null without throwing when athlete_profiles has no row", async () => {
    const supabase = makeFakeSupabase({
      completed_workouts: [completedRow()],
      workout_matches: [],
      athlete_profiles: [],
    });
    const ctx = await gatherReportContext({
      supabase,
      athleteId: ATHLETE_ID,
      completedWorkoutId: COMPLETED_ID,
    });
    expect(ctx.profile).toBeNull();
  });

  it("returns profile: null (not a throw) when the athlete_profiles read errors", async () => {
    const supabase = makeFakeSupabase(
      { completed_workouts: [completedRow()], workout_matches: [] },
      ["athlete_profiles"]
    );
    const ctx = await gatherReportContext({
      supabase,
      athleteId: ATHLETE_ID,
      completedWorkoutId: COMPLETED_ID,
    });
    expect(ctx.profile).toBeNull();
  });

  it("returns the active plan's event_date + goal (event_type) when present", async () => {
    const supabase = makeFakeSupabase({
      completed_workouts: [completedRow()],
      workout_matches: [],
      plans: [
        {
          id: "plan-1",
          athlete_id: ATHLETE_ID,
          status: "active",
          event_date: "2026-09-01",
          event_type: "marathon",
          deleted_at: null,
        },
      ],
    });
    const ctx = await gatherReportContext({
      supabase,
      athleteId: ATHLETE_ID,
      completedWorkoutId: COMPLETED_ID,
    });
    expect(ctx.plan).toEqual({ id: "plan-1", event_date: "2026-09-01", goal: "marathon" });
  });

  it("returns plan: null without throwing when there is no active plan", async () => {
    const supabase = makeFakeSupabase({
      completed_workouts: [completedRow()],
      workout_matches: [],
      plans: [],
    });
    const ctx = await gatherReportContext({
      supabase,
      athleteId: ATHLETE_ID,
      completedWorkoutId: COMPLETED_ID,
    });
    expect(ctx.plan).toBeNull();
  });

  it("builds a non-empty recentLoad series from completed-workout history up to the reported day", async () => {
    const history: Row[] = Array.from({ length: 10 }, (_, i) => ({
      id: `hist-${i}`,
      athlete_id: ATHLETE_ID,
      sport: "run",
      started_at: `2026-06-0${i + 1}T08:00:00.000Z`,
      distance_m: 5000,
      duration_s: 1800,
      summary_stats: { tss: 40 },
      superseded_by_id: null,
      deleted_at: null,
    }));
    const supabase = makeFakeSupabase({
      completed_workouts: [completedRow(), ...history],
      workout_matches: [],
    });
    const ctx = await gatherReportContext({
      supabase,
      athleteId: ATHLETE_ID,
      completedWorkoutId: COMPLETED_ID,
    });
    expect(ctx.recentLoad.series.length).toBeGreaterThan(0);
    expect(ctx.recentLoad.ctl).toBeGreaterThan(0);
  });

  it("returns match: null (not a throw) when the workout_matches read itself errors", async () => {
    const supabase = makeFakeSupabase(
      { completed_workouts: [completedRow()], workout_matches: [matchRow()] },
      ["workout_matches"]
    );
    const ctx = await gatherReportContext({
      supabase,
      athleteId: ATHLETE_ID,
      completedWorkoutId: COMPLETED_ID,
    });
    expect(ctx.match).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pickBestMatch (the documented tiebreak, pinned directly)
// ---------------------------------------------------------------------------

describe("pickBestMatch", () => {
  it("returns null for an empty list", () => {
    expect(pickBestMatch([])).toBeNull();
  });

  it("picks the single row when only one exists", () => {
    const row = { id: "a", planned_workout_id: "pw", confidence: 0.5, method: "auto_same_day_sport" as const, matched_at: "2026-01-01T00:00:00.000Z" };
    expect(pickBestMatch([row])).toBe(row);
  });

  it("picks the highest confidence", () => {
    const low = { id: "a", planned_workout_id: "pw", confidence: 0.2, method: "auto_same_day_sport" as const, matched_at: "2026-01-01T00:00:00.000Z" };
    const high = { id: "b", planned_workout_id: "pw", confidence: 0.8, method: "auto_same_day_sport" as const, matched_at: "2026-01-01T00:00:00.000Z" };
    expect(pickBestMatch([low, high])).toBe(high);
    expect(pickBestMatch([high, low])).toBe(high); // row order independent
  });

  it("breaks a confidence tie by the most recent matched_at", () => {
    const older = { id: "a", planned_workout_id: "pw", confidence: 0.5, method: "auto_same_day_sport" as const, matched_at: "2026-01-01T00:00:00.000Z" };
    const newer = { id: "b", planned_workout_id: "pw", confidence: 0.5, method: "auto_same_day_sport" as const, matched_at: "2026-02-01T00:00:00.000Z" };
    expect(pickBestMatch([older, newer])).toBe(newer);
    expect(pickBestMatch([newer, older])).toBe(newer);
  });

  it("breaks a confidence + matched_at tie by the lexicographically greatest id", () => {
    const a = { id: "aaa", planned_workout_id: "pw", confidence: 0.5, method: "auto_same_day_sport" as const, matched_at: "2026-01-01T00:00:00.000Z" };
    const b = { id: "bbb", planned_workout_id: "pw", confidence: 0.5, method: "auto_same_day_sport" as const, matched_at: "2026-01-01T00:00:00.000Z" };
    expect(pickBestMatch([a, b])).toBe(b);
    expect(pickBestMatch([b, a])).toBe(b);
  });
});
