import { describe, expect, it } from "vitest";

import { mondayOf, summarizePlan, todayIn, type PlanWorkoutInput } from "../plan-summary";

function w(date: string, sport: string, durationS: number, status = "planned"): PlanWorkoutInput {
  return { id: `${date}-${sport}`, scheduled_date: date, sport, status, structure: { duration_s: durationS } };
}

describe("summarizePlan", () => {
  it("groups by ISO week, totals volume and finds the next session", () => {
    const summary = summarizePlan(
      [w("2026-10-12", "run", 3600, "completed"), w("2026-10-14", "bike", 5400), w("2026-10-20", "run", 1800)],
      "2026-10-13",
    );
    expect(summary.weeks).toHaveLength(2);
    expect(summary.currentWeekIndex).toBe(0);
    expect(summary.done).toBe(1);
    expect(summary.weeks[0].durationS).toBe(9000);
    expect(summary.sportSeconds[0]).toEqual({ sport: "run", seconds: 5400 });
    expect(summary.next?.sport).toBe("bike");
    expect(summary.thisWeek).toHaveLength(2);
  });

  it("reads the legacy minute-based duration spelling", () => {
    const summary = summarizePlan(
      [{ id: "a", scheduled_date: "2026-10-14", sport: "run", status: "planned", structure: { est_duration_min: 45 } }],
      "2026-10-14",
    );
    expect(summary.totalDurationS).toBe(2700);
  });

  it("has no current week when today falls outside the plan", () => {
    expect(summarizePlan([w("2026-10-14", "run", 600)], "2026-12-01").currentWeekIndex).toBeNull();
  });
});

describe("date helpers", () => {
  it("finds Monday for a Sunday", () => {
    expect(mondayOf("2026-10-18")).toBe("2026-10-12");
  });

  it("resolves today in the athlete's timezone, not UTC", () => {
    expect(todayIn("Pacific/Auckland", new Date("2026-10-13T20:00:00Z"))).toBe("2026-10-14");
  });
});
