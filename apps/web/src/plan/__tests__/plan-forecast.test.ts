import { describe, expect, it } from "vitest";

import { formVerdict } from "@/training-overview/calc";
import { addDays, buildLoadSeries, type LoadWorkoutInput } from "@/training-load/load-series";

import {
  EVENT_COVERAGE_DAYS,
  MISSING_LOAD_SHARE_LIMIT,
  forecastPlan,
} from "../plan-forecast";
import type { CountedSession } from "../plan-view-types";

const TODAY = "2026-10-16";

function session(date: string, over: Partial<CountedSession> = {}): CountedSession {
  return {
    id: `s-${date}-${Math.random()}`,
    date,
    sport: "run",
    status: "planned",
    structure: null,
    plannedLoadColumn: 50,
    rationale: null,
    ...over,
  };
}

function history(): LoadWorkoutInput[] {
  return Array.from({ length: 30 }, (_, i) => ({
    started_at: `${addDays(TODAY, -30 + i)}T07:00:00Z`,
    duration_s: 3600,
    summary_stats: { tss_equivalent: 60 },
  }));
}

function fourWeekPlan(): CountedSession[] {
  return Array.from({ length: 28 }, (_, i) => session(addDays(TODAY, i)));
}

function expectFinite(f: ReturnType<typeof forecastPlan>): void {
  if (f.status !== "ok") return;
  expect(Number.isFinite(f.ctl)).toBe(true);
  expect(Number.isFinite(f.atl)).toBe(true);
  expect(Number.isFinite(f.tsb)).toBe(true);
  if (f.eventDay) expect(Number.isFinite(f.eventDay.tsb)).toBe(true);
}

describe("forecastPlan", () => {
  it("exports the named constants", () => {
    expect(MISSING_LOAD_SHARE_LIMIT).toBe(0.5);
    expect(EVENT_COVERAGE_DAYS).toBe(2);
  });

  it("AE4: 4-week plan with the event 10 weeks out has no event-day figure", () => {
    const remaining = fourWeekPlan();
    const f = forecastPlan({
      history: history(),
      remaining,
      today: TODAY,
      eventDate: addDays(TODAY, 70),
    });
    expect(f.status).toBe("ok");
    if (f.status !== "ok") return;
    expect(f.endOfBlockDate).toBe(addDays(TODAY, 27));
    expect(f.eventDay).toBeNull();
    expect(f.formVerdict).toBe(formVerdict(f.tsb));
    expectFinite(f);
  });

  it("includes event-day form when the plan ends the day before the event", () => {
    const remaining = fourWeekPlan();
    const eventDate = addDays(TODAY, 28);
    const f = forecastPlan({ history: history(), remaining, today: TODAY, eventDate });
    expect(f.status).toBe("ok");
    if (f.status !== "ok") return;
    expect(f.eventDay).not.toBeNull();
    expect(f.eventDay?.date).toBe(eventDate);
    expect(f.eventDay?.formVerdict).toBe(formVerdict(f.eventDay?.tsb ?? 0));
    expectFinite(f);
  });

  it("omits event day when the event is before the end of the block or beyond coverage", () => {
    const remaining = fourWeekPlan();
    const before = forecastPlan({
      history: history(),
      remaining,
      today: TODAY,
      eventDate: addDays(TODAY, 10),
    });
    const far = forecastPlan({
      history: history(),
      remaining,
      today: TODAY,
      eventDate: addDays(TODAY, 27 + EVENT_COVERAGE_DAYS + 1),
    });
    expect(before.status === "ok" && before.eventDay).toBeNull();
    expect(far.status === "ok" && far.eventDay).toBeNull();
  });

  it("AE5: mostly missing load and duration is unavailable-no-data", () => {
    const remaining = [
      session(addDays(TODAY, 1), { plannedLoadColumn: null }),
      session(addDays(TODAY, 2), { plannedLoadColumn: null }),
      session(addDays(TODAY, 3), { plannedLoadColumn: null }),
      session(addDays(TODAY, 4), { plannedLoadColumn: 40 }),
    ];
    expect(
      forecastPlan({ history: history(), remaining, today: TODAY, eventDate: null }),
    ).toEqual({ status: "unavailable-no-data" });
  });

  it("no remaining sessions is unavailable-complete", () => {
    expect(
      forecastPlan({ history: history(), remaining: [], today: TODAY, eventDate: null }),
    ).toEqual({ status: "unavailable-complete" });
    expect(
      forecastPlan({
        history: history(),
        remaining: [session(TODAY, { status: "completed" })],
        today: TODAY,
        eventDate: null,
      }),
    ).toEqual({ status: "unavailable-complete" });
  });

  it("cold start with empty history still projects and is finite", () => {
    const f = forecastPlan({
      history: [],
      remaining: fourWeekPlan(),
      today: TODAY,
      eventDate: null,
    });
    expect(f.status).toBe("ok");
    if (f.status !== "ok") return;
    expect(f.ctl).toBeGreaterThan(0);
    expectFinite(f);
  });

  it("duration-only sessions use the duration proxy", () => {
    const withDuration = Array.from({ length: 7 }, (_, i) =>
      session(addDays(TODAY, i), {
        plannedLoadColumn: null,
        structure: { duration_s: 3600 },
      }),
    );
    const f = forecastPlan({ history: [], remaining: withDuration, today: TODAY, eventDate: null });
    expect(f.status).toBe("ok");
    if (f.status !== "ok") return;
    expect(f.ctl).toBeGreaterThan(0);
    expectFinite(f);
  });

  it("zero remaining load matches buildLoadSeries extended to the end date", () => {
    const h = history();
    const endDate = addDays(TODAY, 5);
    const remaining = [session(endDate, { plannedLoadColumn: 0 })];
    const f = forecastPlan({ history: h, remaining, today: TODAY, eventDate: null });
    const expected = buildLoadSeries(h, { asOf: endDate });
    expect(f.status).toBe("ok");
    if (f.status !== "ok") return;
    expect(f.ctl).toBe(expected.ctl);
    expect(f.atl).toBe(expected.atl);
    expect(f.tsb).toBe(Math.round(expected.tsb * 10) / 10);
  });

  it("honors synthetic tss_equivalent load", () => {
    const run = (load: number) =>
      forecastPlan({
        history: history(),
        remaining: [session(addDays(TODAY, 3), { plannedLoadColumn: load })],
        today: TODAY,
        eventDate: null,
      });
    const low = run(0);
    const high = run(100);
    if (low.status !== "ok" || high.status !== "ok") throw new Error("expected ok");
    expect(high.ctl).toBeGreaterThan(low.ctl);
  });
});
