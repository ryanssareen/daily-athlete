import { describe, expect, it } from "vitest";

import type { PlanViewForecast, PlanViewWeek } from "@da2/shared";

import {
  barTextEquivalent,
  complianceBar,
  EMPTY_COPY,
  forecastCopy,
  hoursText,
  phaseLabel,
  verdictChip,
  verdictsUnavailableNote,
  weekHeader,
} from "../plan-view-format";

function week(overrides: Partial<PlanViewWeek> = {}): PlanViewWeek {
  return {
    start: "2026-10-12",
    phase: "build",
    focus: "Run-led week",
    plannedSeconds: 14_400,
    executedSeconds: 11_400,
    dueSeconds: 14_400,
    compliance: 0.79,
    skippedCount: 0,
    current: false,
    sessions: [],
    ...overrides,
  };
}

const okForecast: PlanViewForecast = {
  status: "ok",
  endOfBlockDate: "2026-11-08",
  ctl: 52.4,
  atl: 48.1,
  tsb: 4.3,
  formVerdict: "Fresh and ready to perform",
  eventDay: { date: "2026-11-09", tsb: -7.8, formVerdict: "Slightly tired" },
};

describe("verdictChip", () => {
  it("maps all five codes to a text label and tone", () => {
    expect(verdictChip("executed_as_prescribed")).toEqual({ label: "As prescribed", tone: "positive" });
    expect(verdictChip("under_executed")).toEqual({ label: "Under target", tone: "warning" });
    expect(verdictChip("over_executed")).toEqual({ label: "Over target", tone: "warning" });
    expect(verdictChip("partial_data")).toEqual({ label: "Partial data", tone: "neutral" });
    expect(verdictChip("unplanned_effort")).toEqual({ label: "Unplanned", tone: "neutral" });
  });
});

describe("complianceBar", () => {
  it("renders null as not yet due with an empty bar", () => {
    expect(complianceBar(null)).toEqual({ widthPercent: 0, percentText: "not yet due", ahead: false });
  });

  it("renders a fraction as width and percent", () => {
    expect(complianceBar(0.75)).toEqual({ widthPercent: 75, percentText: "75%", ahead: false });
  });

  it("clamps width at 100 and flags ahead of plan above 1", () => {
    expect(complianceBar(1.06)).toEqual({ widthPercent: 100, percentText: "106%", ahead: true });
  });

  it("does not flag exactly 100%", () => {
    expect(complianceBar(1)).toEqual({ widthPercent: 100, percentText: "100%", ahead: false });
  });
});

describe("bar text equivalent and hours text", () => {
  it("describes the bar in words", () => {
    expect(barTextEquivalent(10_800, 14_400, 0.75)).toBe("3 of 4 hours, 75%");
  });

  it("handles fractional hours and not-yet-due", () => {
    expect(barTextEquivalent(5_400, 14_400, 0.375)).toBe("1.5 of 4 hours, 38%");
    expect(barTextEquivalent(0, 0, null)).toBe("Not yet due");
  });

  it("formats hours executed of planned", () => {
    expect(hoursText(11_400, 14_400)).toBe("3h 10m of 4h");
    expect(hoursText(0, 0)).toBe("0m of 0m");
  });
});

describe("weekHeader", () => {
  const today = "2026-10-16";

  it("labels the current week", () => {
    const h = weekHeader(week({ current: true, skippedCount: 1 }), 0, today);
    expect(h.timing).toBe("current");
    expect(h.label).toBe("Week 1 · Oct 12");
    expect(h.currentTag).toBe("This week");
    expect(h.phaseLabel).toBe("Build");
    expect(h.hoursText).toBe("3h 10m of 4h");
    expect(h.complianceText).toBe("79%");
    expect(h.skippedText).toBe("1 skipped");
  });

  it("labels a past week without a current tag", () => {
    const h = weekHeader(week({ start: "2026-10-05" }), 0, today);
    expect(h.timing).toBe("past");
    expect(h.currentTag).toBeNull();
    expect(h.skippedText).toBeNull();
  });

  it("labels a future week as upcoming when nothing is due", () => {
    const h = weekHeader(
      week({ start: "2026-10-26", compliance: null, executedSeconds: 0, dueSeconds: 0 }),
      2,
      today
    );
    expect(h.timing).toBe("future");
    expect(h.label).toBe("Week 3 · Oct 26");
    expect(h.complianceText).toBe("Upcoming");
  });

  it("shows not yet due for a current week with nothing due", () => {
    const h = weekHeader(week({ current: true, compliance: null, dueSeconds: 0 }), 0, today);
    expect(h.complianceText).toBe("not yet due");
  });

  it("omits the phase label when phase is null", () => {
    expect(weekHeader(week({ phase: null }), 0, today).phaseLabel).toBeNull();
    expect(phaseLabel(null)).toBeNull();
    expect(phaseLabel("taper")).toBe("Taper");
  });
});

describe("forecastCopy", () => {
  it("renders the ok forecast with figures, end of block and event day", () => {
    const copy = forecastCopy(okForecast, []);
    if (copy.kind !== "ok") throw new Error("expected ok");
    expect(copy.headline).toBe("Fresh and ready to perform");
    expect(copy.figures.map((f) => [f.label, f.value])).toEqual([
      ["Fitness (CTL)", "52"],
      ["Fatigue (ATL)", "48"],
      ["Form (TSB)", "+4"],
    ]);
    expect(copy.figures.every((f) => f.meaning.length > 0)).toBe(true);
    expect(copy.endLabel).toBe("End of block, Nov 8");
    expect(copy.eventLabel).toBe("On Nov 9");
    expect(copy.eventForm).toBe("-8");
    expect(copy.eventVerdict).toBe("Slightly tired");
  });

  it("omits event day when absent", () => {
    const copy = forecastCopy({ ...okForecast, eventDay: null }, []);
    if (copy.kind !== "ok") throw new Error("expected ok");
    expect(copy.eventLabel).toBeNull();
  });

  it("uses distinct copy for unavailable states", () => {
    expect(forecastCopy({ status: "unavailable-no-data" }, [])).toEqual({
      kind: "unavailable",
      title: "Not enough planned load to forecast",
    });
    expect(forecastCopy({ status: "unavailable-complete" }, [])).toEqual({
      kind: "complete",
      title: "This block is finished",
    });
  });

  it("uses failed-read copy when sectionErrors includes forecast", () => {
    expect(forecastCopy({ status: "unavailable-no-data" }, ["forecast"])).toEqual({
      kind: "failed",
      title: "Couldn't load the forecast",
    });
  });
});

describe("notes and empty states", () => {
  it("notes unavailable verdicts only when that section failed", () => {
    expect(verdictsUnavailableNote(["verdicts"])).toBe("Verdicts unavailable right now");
    expect(verdictsUnavailableNote(["forecast"])).toBeNull();
    expect(verdictsUnavailableNote([])).toBeNull();
  });

  it("exposes empty-state copy", () => {
    expect(EMPTY_COPY.noWorkouts).toBe("No workouts scheduled yet");
    expect(EMPTY_COPY.noResults).toBe("Results appear as you complete sessions");
    expect(EMPTY_COPY.nothingDue).toBe("Nothing was due this week");
  });
});
