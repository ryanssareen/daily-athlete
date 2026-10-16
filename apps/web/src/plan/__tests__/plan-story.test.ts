import { describe, expect, it } from "vitest";

import type { PlanPhase } from "@da2/shared";

import type { CountedSession } from "../plan-view-types";
import {
  RECOVERY_FRACTION,
  composePlanStory,
  composeWeekFocus,
  detectPhases,
} from "../plan-story";

let counter = 0;

function session(
  date: string,
  minutes: number | null,
  overrides: Partial<CountedSession> = {},
): CountedSession {
  counter += 1;
  return {
    id: `s${counter}`,
    date,
    sport: "run",
    status: "planned",
    structure: minutes == null ? null : { duration_s: minutes * 60 },
    plannedLoadColumn: null,
    rationale: null,
    ...overrides,
  };
}

function week(monday: string, minutesPerSession: number | null, overrides: Partial<CountedSession> = {}) {
  const base = new Date(`${monday}T00:00:00Z`);
  return [0, 2, 6].map((offset) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + offset);
    return session(d.toISOString().slice(0, 10), minutesPerSession, overrides);
  });
}

const MONDAYS = ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"];

function fourWeekPlan(): CountedSession[] {
  return [
    ...week(MONDAYS[0], 100),
    ...week(MONDAYS[1], 120),
    ...week(MONDAYS[2], 80),
    ...week(MONDAYS[3], 140, { rationale: "Race-specific long effort to lock in marathon pace." }),
  ];
}

describe("detectPhases", () => {
  it("labels build, recovery and peak from the volume shape", () => {
    const phases = detectPhases({ sessions: fourWeekPlan(), eventDate: "2026-11-22" });
    expect(phases.get(MONDAYS[0])).toBe("build");
    expect(phases.get(MONDAYS[1])).toBe("build");
    expect(phases.get(MONDAYS[2])).toBe("recovery");
    expect(phases.get(MONDAYS[3])).toBe("peak");
  });

  it("labels the weeks before the event that drop under the prior peak as taper", () => {
    const sessions = [...fourWeekPlan(), ...week("2026-11-16", 60)];
    const phases = detectPhases({ sessions, eventDate: "2026-11-22" });
    expect(phases.get("2026-11-16")).toBe("taper");
    expect(phases.get(MONDAYS[3])).toBe("peak");
  });

  it("makes no recovery or taper claim for a 1-week plan", () => {
    const phases = detectPhases({ sessions: week(MONDAYS[0], 60), eventDate: "2026-10-25" });
    expect([...phases.values()]).toEqual(["build"]);
  });

  it("makes no recovery, peak or taper claim for equal-volume weeks", () => {
    const sessions = MONDAYS.flatMap((m) => week(m, 60));
    const phases = detectPhases({ sessions, eventDate: "2026-11-15" });
    expect([...phases.values()].every((p) => p === "build")).toBe(true);
  });

  it("treats exactly RECOVERY_FRACTION of the previous week as recovery", () => {
    const sessions = [...week(MONDAYS[0], 100), ...week(MONDAYS[1], 100 * RECOVERY_FRACTION), ...week(MONDAYS[2], 100)];
    expect(detectPhases({ sessions, eventDate: null }).get(MONDAYS[1])).toBe("recovery");
  });

  it("never labels the final week recovery", () => {
    const sessions = [...week(MONDAYS[0], 100), ...week(MONDAYS[1], 50)];
    expect(detectPhases({ sessions, eventDate: null }).get(MONDAYS[1])).not.toBe("recovery");
  });

  it("uses stored structure.phase labels when every session has one", () => {
    const sessions = [
      session("2026-10-19", 60, { structure: { duration_s: 3600, phase: "peak" } }),
      session("2026-10-21", 60, { structure: { duration_s: 3600, phase: "peak" } }),
      session("2026-10-23", 60, { structure: { duration_s: 3600, phase: "build" } }),
      session("2026-10-26", 60, { structure: { duration_s: 3600, phase: "taper" } }),
    ];
    const phases = detectPhases({ sessions, eventDate: null });
    expect(phases.get("2026-10-19")).toBe("peak");
    expect(phases.get("2026-10-26")).toBe("taper");
  });

  it("falls back to derived labels when only some sessions carry a phase", () => {
    const sessions = fourWeekPlan().map((s, i) =>
      i === 0 ? { ...s, structure: { duration_s: 6000, phase: "taper" } } : s,
    );
    const phases = detectPhases({ sessions, eventDate: null });
    expect(phases.get(MONDAYS[0])).toBe("build");
    expect(phases.get(MONDAYS[2])).toBe("recovery");
  });

  it("falls back when a stored phase is not a valid label", () => {
    const sessions = week(MONDAYS[0], 60).map((s) => ({ ...s, structure: { duration_s: 3600, phase: "base" } }));
    expect(detectPhases({ sessions, eventDate: null }).get(MONDAYS[0])).toBe("build");
  });

  it("gives weeks with no duration data a null phase", () => {
    const sessions = [...week(MONDAYS[0], 60), ...week(MONDAYS[1], null)];
    const phases = detectPhases({ sessions, eventDate: null });
    expect(phases.get(MONDAYS[1])).toBeNull();
  });
});

describe("composePlanStory", () => {
  const today = "2026-11-01";

  function story(
    sessions: CountedSession[],
    opts: { eventType?: string | null; eventDate?: string | null; today?: string } = {},
  ) {
    const eventDate = opts.eventDate ?? null;
    return composePlanStory({
      sessions,
      eventType: opts.eventType ?? null,
      eventDate,
      today: opts.today ?? today,
      phases: detectPhases({ sessions, eventDate }),
    });
  }

  it("AE1: imported-style plan describes shape and volume with no event or reason text", () => {
    const sessions = MONDAYS.flatMap((m) => week(m, 60));
    const result = story(sessions);
    const text = result.paragraphs.join(" ");
    expect(text).toContain("4-week");
    expect(text).toContain("12h");
    expect(text.toLowerCase()).not.toMatch(/event|race|days? (away|to)|because|why/);
    expect(result.whyQuote).toBeNull();
    expect(result.paragraphs.length).toBeGreaterThanOrEqual(1);
    expect(result.paragraphs.length).toBeLessThanOrEqual(3);
  });

  it("names build, recovery and the event date for a 4-week plan with an event 3 weeks out", () => {
    const result = story(fourWeekPlan(), { eventType: "marathon", eventDate: "2026-11-22" });
    const text = result.paragraphs.join(" ");
    expect(text).toMatch(/build/i);
    expect(text).toMatch(/recovery/i);
    expect(text).toMatch(/peak/i);
    expect(text).toContain("marathon");
    expect(text).toContain("Nov 22");
    expect(text).toContain("21 days");
    expect(result.whyQuote).toBe("Race-specific long effort to lock in marathon pace.");
  });

  it("makes no recovery or taper claim for 1-week, single-sport and equal-volume plans", () => {
    const plans = [week(MONDAYS[0], 60), MONDAYS.flatMap((m) => week(m, 60))];
    for (const sessions of plans) {
      const text = story(sessions).paragraphs.join(" ").toLowerCase();
      expect(text).not.toMatch(/recovery|taper|peak/);
    }
  });

  it("says mostly <sport> for a mixed plan and all <sport> for a single-sport plan", () => {
    const mixed = [...week(MONDAYS[0], 60), session("2026-10-20", 30, { sport: "bike" })];
    expect(story(mixed).paragraphs[0]).toContain("mostly run");
    expect(story(week(MONDAYS[0], 60)).paragraphs[0]).toContain("all run");
  });

  it("gives no days-to text when the event date is in the past", () => {
    const result = story(fourWeekPlan(), { eventType: "marathon", eventDate: "2026-10-25" });
    const text = result.paragraphs.join(" ");
    expect(text).not.toMatch(/days? (away|to)|in \d+ days/i);
    expect(text).not.toContain("Oct 25");
  });

  it("says today when the event is today", () => {
    const text = story(fourWeekPlan(), { eventDate: today }).paragraphs.join(" ");
    expect(text).toContain("today");
  });

  it("never emits NaN or 0h when durations and loads are null", () => {
    const sessions = MONDAYS.flatMap((m) => week(m, null));
    const result = story(sessions);
    const text = result.paragraphs.join(" ");
    expect(text).not.toMatch(/NaN|\b0h\b|\b0m\b|undefined/);
    expect(text).toContain("12 sessions");
    expect(result.paragraphs.length).toBeGreaterThanOrEqual(1);
  });

  it("returns null whyQuote when the peak week's longest session has no rationale", () => {
    const sessions = fourWeekPlan().map((s) => ({ ...s, rationale: null }));
    expect(story(sessions).whyQuote).toBeNull();
  });

  it("truncates a long rationale to 300 chars at a word boundary", () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    const sessions = fourWeekPlan().map((s) => (s.rationale ? { ...s, rationale: long } : s));
    const quote = story(sessions).whyQuote;
    expect(quote).not.toBeNull();
    expect(quote!.length).toBeLessThanOrEqual(300);
    expect(quote!.endsWith("…")).toBe(true);
    expect(long.startsWith(quote!.slice(0, -1))).toBe(true);
    expect(long.charAt(quote!.length - 1)).toBe(" ");
  });

  it("is deterministic", () => {
    const sessions = fourWeekPlan();
    const input = { eventType: "marathon", eventDate: "2026-11-22" };
    expect(story(sessions, input)).toEqual(story(sessions, input));
  });

  it("returns at least one paragraph for an empty plan", () => {
    const result = composePlanStory({
      sessions: [],
      eventType: null,
      eventDate: null,
      today,
      phases: new Map<string, PlanPhase | null>(),
    });
    expect(result.paragraphs.length).toBe(1);
    expect(result.whyQuote).toBeNull();
  });
});

describe("composeWeekFocus", () => {
  it("names the dominant sport and the longest session by weekday", () => {
    const sessions = [
      session("2026-10-20", 45),
      session("2026-10-22", 40),
      session("2026-10-25", 120),
      session("2026-10-21", 30, { sport: "bike" }),
    ];
    expect(composeWeekFocus(sessions)).toBe("Run focus, long run Sun");
  });

  it("omits the long session when there is no duration data", () => {
    const text = composeWeekFocus([session("2026-10-20", null), session("2026-10-22", null)]);
    expect(text).toBe("Run focus");
  });

  it("returns No sessions for an empty week", () => {
    expect(composeWeekFocus([])).toBe("No sessions");
  });

  it("stays within 200 chars", () => {
    expect(composeWeekFocus(week(MONDAYS[0], 60)).length).toBeLessThanOrEqual(200);
  });
});
