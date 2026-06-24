import { describe, expect, it } from "vitest";

import { GeneratedPlanSchema, type GeneratedPlan } from "@da2/shared";

import { dayDiff } from "@/training-load";

import { realignPlanToToday } from "../realign-dates";

const TODAY = "2026-06-24";

function planOn(dates: string[], event_date: string | null = null): GeneratedPlan {
  return GeneratedPlanSchema.parse({
    event_type: null,
    event_date,
    workouts: dates.map((d) => ({
      scheduled_date: d,
      sport: "run",
      structure: {
        duration_s: 3600,
        load: 50,
        intensity_target: { kind: "zone", value: 2 },
        phase: "base",
      },
      rationale: "Aerobic session.",
      planned_load: 50,
    })),
  });
}

function earliestOf(plan: GeneratedPlan): string {
  return plan.workouts
    .map((w) => w.scheduled_date)
    .reduce((min, d) => (d < min ? d : min));
}

describe("realignPlanToToday", () => {
  it("shifts a past-dated plan forward so the earliest workout is on/after today", () => {
    // The reported prod failure: a plan dated 2024-01-01..07.
    const { plan, shiftedDays } = realignPlanToToday(
      planOn(["2024-01-01", "2024-01-03", "2024-01-05", "2024-01-07"]),
      TODAY
    );
    expect(shiftedDays).toBeGreaterThan(0);
    expect(earliestOf(plan) >= TODAY).toBe(true);
  });

  it("shifts by a whole number of weeks (preserves weekday + ISO-week grouping)", () => {
    const { shiftedDays } = realignPlanToToday(planOn(["2024-01-01"]), TODAY);
    expect(shiftedDays % 7).toBe(0);
  });

  it("lands the earliest workout within [today, today+6] — minimal whole-week shift", () => {
    const { plan } = realignPlanToToday(planOn(["2024-01-01"]), TODAY);
    const offset = dayDiff(TODAY, earliestOf(plan));
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThanOrEqual(6);
  });

  it("preserves relative spacing between workouts", () => {
    const { plan } = realignPlanToToday(
      planOn(["2024-01-01", "2024-01-03", "2024-01-08"]),
      TODAY
    );
    const d = plan.workouts.map((w) => w.scheduled_date);
    expect(dayDiff(d[0], d[1])).toBe(2);
    expect(dayDiff(d[0], d[2])).toBe(7);
  });

  it("is a no-op (same reference) when the plan already starts after today", () => {
    const p = planOn(["2026-07-01", "2026-07-03"]);
    const { plan, shiftedDays } = realignPlanToToday(p, TODAY);
    expect(shiftedDays).toBe(0);
    expect(plan).toBe(p);
  });

  it("is a no-op when the earliest workout is exactly today", () => {
    const { shiftedDays } = realignPlanToToday(
      planOn([TODAY, "2026-06-26"]),
      TODAY
    );
    expect(shiftedDays).toBe(0);
  });

  it("anchors off the EARLIEST date even when workouts are unordered", () => {
    const { plan } = realignPlanToToday(
      planOn(["2024-02-01", "2024-01-01", "2024-01-15"]),
      TODAY
    );
    expect(earliestOf(plan) >= TODAY).toBe(true);
  });

  it("leaves event_date untouched (it is a real-world anchor)", () => {
    const { plan } = realignPlanToToday(
      planOn(["2024-01-01"], "2026-09-01"),
      TODAY
    );
    expect(plan.event_date).toBe("2026-09-01");
  });
});
