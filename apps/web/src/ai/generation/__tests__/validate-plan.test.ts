// Test-first safety contract for the whole-plan forward-simulation validator.
//
// Two regression guards anchor this suite (the document-review P0 findings):
//  - it MUST catch an intra-plan week-over-week ramp spike (the empty-baseline
//    no-op bug), and
//  - it MUST NOT false-refuse a sane multi-week plan (the whole-season-TSS-as-
//    one-day-spike bug).

import { describe, expect, it } from "vitest";
import type { GeneratedPlan, GeneratedWorkout, WorkoutPhase } from "@da2/shared";

import { addDays } from "@/training-load";

import { validateGeneratedPlan } from "../validate-plan";

const START = "2026-06-01"; // a Monday
const SESSION_OFFSETS = [0, 1, 3, 5]; // 4 sessions/week, same ISO week

function phaseFor(weekIdx: number, total: number): WorkoutPhase {
  if (weekIdx >= total - 1) return "taper";
  if (weekIdx >= total - 4) return "peak";
  if (weekIdx >= total / 3) return "build";
  return "base";
}

/** Build a plan from a per-week TSS array (spread evenly over 4 sessions). */
function planFromWeeklyTss(
  weeklyTss: number[],
  opts: { eventDate?: string | null } = {}
): GeneratedPlan {
  const workouts: GeneratedWorkout[] = [];
  weeklyTss.forEach((wt, wi) => {
    const per = wt / SESSION_OFFSETS.length;
    SESSION_OFFSETS.forEach((off) => {
      workouts.push({
        scheduled_date: addDays(START, wi * 7 + off),
        sport: "run",
        structure: {
          duration_s: Math.max(600, Math.round((per / 50) * 3600)),
          load: per,
          intensity_target: { kind: "zone", value: 2 },
          phase: phaseFor(wi, weeklyTss.length),
        },
        rationale: "session",
        planned_load: per,
      });
    });
  });
  return {
    event_type: opts.eventDate ? "race" : null,
    event_date: opts.eventDate ?? null,
    workouts,
  };
}

function codes(plan: GeneratedPlan, ctx: Parameters<typeof validateGeneratedPlan>[1]) {
  return validateGeneratedPlan(plan, ctx).violations.map((v) => v.code);
}

// A realistic 12-week build: gentle ramp, deloads at weeks 3 & 7, taper at the end.
const SANE_WEEKLY = [300, 320, 345, 250, 360, 385, 410, 300, 430, 450, 330, 250];
const BASE_CTX = { seedCtl: 43, seedAtl: 43, recentWeeklyTss: 300 };

describe("validateGeneratedPlan — does not false-refuse a sane plan", () => {
  it("passes a gentle 12-week ramp with deloads (no event)", () => {
    const result = validateGeneratedPlan(planFromWeeklyTss(SANE_WEEKLY), BASE_CTX);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("passes the same plan with an event date and a real taper", () => {
    const plan = planFromWeeklyTss(SANE_WEEKLY, { eventDate: addDays(START, 11 * 7 + 6) });
    expect(validateGeneratedPlan(plan, BASE_CTX).valid).toBe(true);
  });
});

describe("validateGeneratedPlan — catches unsafe load", () => {
  it("flags an intra-plan +40% weekly ramp spike", () => {
    const spiked = [300, 320, 345, 500, 360, 385, 410, 300, 430, 450, 330, 250];
    expect(codes(planFromWeeklyTss(spiked), BASE_CTX)).toContain("volume_ramp");
  });

  it("flags a first week far above the athlete's recent baseline", () => {
    const plan = planFromWeeklyTss([450, 470, 490]);
    expect(codes(plan, BASE_CTX)).toContain("volume_ramp");
  });

  it("flags an unsustainable CTL ramp (flat high load from a low base)", () => {
    const flatHigh = Array(8).fill(700);
    // recentWeeklyTss matches week 1 so the volume-ramp gate stays quiet; the
    // CTL trajectory is what must trip.
    const result = codes(planFromWeeklyTss(flatHigh), {
      seedCtl: 10,
      seedAtl: 10,
      recentWeeklyTss: 700,
    });
    expect(result).toContain("ctl_ramp");
  });

  it("flags a projected TSB below the floor (relentless load, no recovery)", () => {
    const result = codes(planFromWeeklyTss(Array(8).fill(900)), {
      seedCtl: 50,
      seedAtl: 50,
      recentWeeklyTss: 900,
    });
    expect(result).toContain("tsb_floor");
  });
});

describe("validateGeneratedPlan — cold start (no recent baseline)", () => {
  // A true cold start: seed 0/0 and recentWeeklyTss undefined (a brand-new
  // athlete with no history). Week 1 has no ramp baseline, but the intra-plan
  // week-over-week guard must STILL fire — this is the empty-baseline P0 the
  // validator was written to catch, and the path the rest of the suite (which
  // always sets recentWeeklyTss) never exercises.
  const COLD_CTX = { seedCtl: 0, seedAtl: 0 };

  it("does not false-flag a gentle from-scratch ramp on volume", () => {
    // <=8% week-over-week, under the 10% WEEKLY_VOLUME_RAMP_CAP.
    expect(codes(planFromWeeklyTss([100, 108, 116, 124]), COLD_CTX)).not.toContain(
      "volume_ramp"
    );
  });

  it("still catches an intra-plan spike with no recent baseline", () => {
    expect(codes(planFromWeeklyTss([100, 108, 300]), COLD_CTX)).toContain(
      "volume_ramp"
    );
  });
});

describe("validateGeneratedPlan — taper window", () => {
  // Gentle ramp whose hardest weeks sit INSIDE the taper window = no real taper.
  const NO_TAPER = [300, 325, 350, 375, 400, 425, 450, 475, 500, 520, 520, 520];

  it("flags a plan that does not taper before the event", () => {
    const eventDate = addDays(START, 11 * 7 + 6);
    expect(codes(planFromWeeklyTss(NO_TAPER, { eventDate }), BASE_CTX)).toContain(
      "taper_window"
    );
  });

  it("does NOT apply the taper check when there is no event date", () => {
    expect(codes(planFromWeeklyTss(NO_TAPER), BASE_CTX)).not.toContain("taper_window");
  });
});
