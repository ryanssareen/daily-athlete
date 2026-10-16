import { describe, expect, it } from "vitest";

import { computeExecutionDelta, type DeltaInput } from "@/ai/reports/delta";
import { toDeltaInput } from "@/ai/reports/to-delta-input";
import type { ReportContext } from "@/ai/reports/context";
import { readStructureDurationSeconds, readStructureIntensityTarget, readStructureLoad } from "@/ai/planned-structure";

import { computeWeekResults, verdictForSession } from "../plan-results";
import type { CountedSession, MatchedCompleted } from "../plan-view-types";

function session(over: Partial<CountedSession> & { id: string; date: string }): CountedSession {
  return {
    sport: "run",
    status: "planned",
    structure: { duration_s: 3600 },
    plannedLoadColumn: null,
    rationale: null,
    ...over,
  };
}

function completedRun(over: Partial<MatchedCompleted> = {}): MatchedCompleted {
  return {
    duration_s: 2280,
    distance_m: 7000,
    sport: "run",
    summary_stats: { tss: 40 },
    ...over,
  };
}

const WEEK = "2026-10-12";
const NEXT_WEEK = "2026-10-19";

describe("computeWeekResults", () => {
  it("AE2: counts only counted sessions, reports skipped, ignores rows moved to next week", () => {
    const results = computeWeekResults({
      sessions: [
        session({ id: "a", date: "2026-10-12" }),
        session({ id: "b", date: "2026-10-14" }),
        session({ id: "m1", date: "2026-10-20", status: "moved" }),
        session({ id: "m2", date: "2026-10-21", status: "moved" }),
      ],
      skippedDates: ["2026-10-13"],
      matches: new Map(),
      today: "2026-10-16",
    });
    const week = results.get(WEEK);
    expect(week?.sessions.map((s) => s.id)).toEqual(["a", "b"]);
    expect(week?.skippedCount).toBe(1);
    expect(week?.plannedSeconds).toBe(7200);
    expect(week?.dueSeconds).toBe(7200);
    expect(week?.executedSeconds).toBe(0);
    expect(week?.compliance).toBe(0);
    expect(results.get(NEXT_WEEK)?.sessions).toHaveLength(2);
    expect(results.get(NEXT_WEEK)?.compliance).toBeNull();
  });

  it("a moved row dated in the week appears there and is due once its date passes", () => {
    const sessions = [session({ id: "m", date: "2026-10-15", status: "moved" })];
    const before = computeWeekResults({ sessions, skippedDates: [], matches: new Map(), today: "2026-10-14" });
    expect(before.get(WEEK)?.sessions[0]?.status).toBe("moved");
    expect(before.get(WEEK)?.dueSeconds).toBe(0);
    expect(before.get(WEEK)?.compliance).toBeNull();
    const after = computeWeekResults({ sessions, skippedDates: [], matches: new Map(), today: "2026-10-15" });
    expect(after.get(WEEK)?.dueSeconds).toBe(3600);
    expect(after.get(WEEK)?.compliance).toBe(0);
  });

  it("future week and not-yet-due sessions give null compliance", () => {
    const results = computeWeekResults({
      sessions: [session({ id: "f", date: "2026-10-28" }), session({ id: "t", date: "2026-10-17" })],
      skippedDates: [],
      matches: new Map(),
      today: "2026-10-16",
    });
    expect(results.get("2026-10-26")?.compliance).toBeNull();
    expect(results.get(WEEK)?.compliance).toBeNull();
    expect(results.get(WEEK)?.plannedSeconds).toBe(3600);
  });

  it("completed session with no match is completed, due, executed at planned seconds, no verdict", () => {
    const results = computeWeekResults({
      sessions: [session({ id: "c", date: "2026-10-20", status: "completed" })],
      skippedDates: [],
      matches: new Map(),
      today: "2026-10-16",
    });
    const week = results.get(NEXT_WEEK);
    expect(week?.sessions[0]?.status).toBe("completed");
    expect(week?.sessions[0]?.verdict).toBeNull();
    expect(week?.dueSeconds).toBe(3600);
    expect(week?.executedSeconds).toBe(3600);
    expect(week?.compliance).toBe(1);
  });

  it("est_duration_min-only session contributes planned seconds", () => {
    const results = computeWeekResults({
      sessions: [session({ id: "e", date: "2026-10-13", structure: { est_duration_min: 50 } })],
      skippedDates: [],
      matches: new Map(),
      today: "2026-10-16",
    });
    expect(results.get(WEEK)?.plannedSeconds).toBe(3000);
    expect(results.get(WEEK)?.sessions[0]?.plannedSeconds).toBe(3000);
  });

  it("compliance over 100% is finite and above 1", () => {
    const results = computeWeekResults({
      sessions: [session({ id: "o", date: "2026-10-13", status: "completed", structure: { duration_s: 1800 } })],
      skippedDates: [],
      matches: new Map([["o", completedRun({ duration_s: 3600 })]]),
      today: "2026-10-16",
    });
    const compliance = results.get(WEEK)?.compliance;
    expect(Number.isFinite(compliance)).toBe(true);
    expect(compliance).toBe(2);
  });

  it("a skipped-only week still appears", () => {
    const results = computeWeekResults({
      sessions: [],
      skippedDates: ["2026-10-13"],
      matches: new Map(),
      today: "2026-10-16",
    });
    expect(results.get(WEEK)).toMatchObject({ skippedCount: 1, sessions: [], compliance: null, plannedSeconds: 0 });
  });

  it("sorts sessions by date then id and shapes fields", () => {
    const results = computeWeekResults({
      sessions: [
        session({ id: "z", date: "2026-10-13" }),
        session({
          id: "b",
          date: "2026-10-13",
          rationale: `  ${"x".repeat(700)}  `,
          structure: { duration_s: 600, intensity_target: { kind: "zone", value: 2 } },
          plannedLoadColumn: 33,
        }),
        session({ id: "a", date: "2026-10-12", structure: { intensity: "easy" }, rationale: "   " }),
      ],
      skippedDates: [],
      matches: new Map(),
      today: "2026-10-01",
    });
    const sessions = results.get(WEEK)?.sessions ?? [];
    expect(sessions.map((s) => s.id)).toEqual(["a", "b", "z"]);
    expect(sessions[0]).toMatchObject({ plannedSeconds: null, intensity: null, rationale: null });
    expect(sessions[1]).toMatchObject({ intensity: "Zone 2", plannedLoad: 33, plannedSeconds: 600 });
    expect(sessions[1]?.rationale).toHaveLength(600);
  });
});

describe("verdictForSession", () => {
  it("returns null without a match", () => {
    expect(verdictForSession(session({ id: "x", date: WEEK }), undefined)).toBeNull();
  });

  it("AE3: equals the report-path verdict for a 45 min run matched to a 38 min run", () => {
    const planned = session({ id: "p", date: "2026-10-13", structure: { duration_s: 2700 }, plannedLoadColumn: 50 });
    const completed = completedRun();
    const context: ReportContext = {
      athleteId: "a1",
      completedWorkout: {
        id: "c1",
        sport: completed.sport,
        started_at: "2026-10-13T07:00:00Z",
        distance_m: completed.distance_m,
        duration_s: completed.duration_s,
        summary_stats: completed.summary_stats,
        superseded_by_id: null,
      },
      match: {
        id: planned.id,
        scheduled_date: planned.date,
        sport: planned.sport,
        status: "completed",
        structure: planned.structure,
        planned_load: planned.plannedLoadColumn,
        duration_s: readStructureDurationSeconds(planned.structure),
        load: readStructureLoad(planned.structure, planned.plannedLoadColumn),
        intensity_target: readStructureIntensityTarget(planned.structure),
        match: { id: "m1", confidence: 1, method: "auto_same_day_sport", matched_at: "2026-10-13T08:00:00Z" },
      } as NonNullable<ReportContext["match"]>,
      profile: null,
      plan: null,
      recentLoad: { series: [], ctl: 0, atl: 0, tsb: 0, ctlRampPerWeek: 0, powerConfidenceRatio: 0 },
    };
    const expected = computeExecutionDelta(toDeltaInput(context)).verdict;
    expect(verdictForSession(planned, completed)).toEqual(expected);
  });

  it("matched workout missing duration and stats yields partial_data without throwing", () => {
    const verdict = verdictForSession(
      session({ id: "p", date: WEEK, structure: { duration_s: 2700 } }),
      completedRun({ duration_s: null, distance_m: null, summary_stats: {} }),
    );
    expect(verdict?.code).toBe("partial_data");
  });

  it("is consistent with computeExecutionDelta on the same DeltaInput", () => {
    const input: DeltaInput = {
      matched: true,
      completed: completedRun(),
      planned: { sport: "run", planned_load: null, structure: { duration_s: 2700 } },
    };
    expect(verdictForSession(session({ id: "p", date: WEEK, structure: { duration_s: 2700 } }), completedRun())).toEqual(
      computeExecutionDelta(input).verdict,
    );
  });
});
