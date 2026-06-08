import { describe, expect, it } from "vitest";
import type { GeneratedPlan, GeneratedWorkout, WorkoutPhase } from "@da2/shared";

import { addDays } from "@/training-load";

import { scorePlanDeterministic } from "../deterministic";

const START = "2026-06-01";
const OFFSETS = [0, 1, 3, 5];
const CTX = { seedCtl: 43, seedAtl: 43, recentWeeklyTss: 300 };

function phaseFor(wi: number, total: number): WorkoutPhase {
  if (wi >= total - 1) return "taper";
  if (wi >= total - 3) return "peak";
  if (wi >= total / 3) return "build";
  return "base";
}

function planFromWeeklyTss(
  weekly: number[],
  opts: { eventDate?: string | null; rationale?: string } = {}
): GeneratedPlan {
  const workouts: GeneratedWorkout[] = [];
  weekly.forEach((wt, wi) => {
    const per = wt / OFFSETS.length;
    OFFSETS.forEach((off) =>
      workouts.push({
        scheduled_date: addDays(START, wi * 7 + off),
        sport: "run",
        structure: {
          duration_s: 3600,
          load: per,
          intensity_target: { kind: "zone", value: 2 },
          phase: phaseFor(wi, weekly.length),
        },
        rationale: opts.rationale ?? "Aerobic session.",
        planned_load: per,
      })
    );
  });
  return { event_type: opts.eventDate ? "race" : null, event_date: opts.eventDate ?? null, workouts };
}

const SANE = [300, 320, 345, 250, 360, 385, 410, 300, 430, 450, 330, 250];

describe("scorePlanDeterministic", () => {
  it("passes a sane, periodized, tapered plan", () => {
    const result = scorePlanDeterministic(
      planFromWeeklyTss(SANE, { eventDate: addDays(START, 11 * 7 + 6) }),
      CTX
    );
    expect(result.ok).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails the gate when the plan is unsafe (mandatory load_safety)", () => {
    const spiked = [300, 320, 345, 500, 360, 385, 410, 300, 430, 450, 330, 250];
    const result = scorePlanDeterministic(planFromWeeklyTss(spiked), CTX);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "load_safety")?.passed).toBe(false);
  });

  it("fails the gate when content has a medical claim (mandatory)", () => {
    const result = scorePlanDeterministic(
      planFromWeeklyTss(SANE, { rationale: "Take ibuprofen and run through the pain." }),
      CTX
    );
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "no_medical_claims")?.passed).toBe(false);
  });

  it("flags a missing taper when an event is set", () => {
    // Hardest weeks inside the taper window -> validator taper_window + the
    // structural taper_present check both react.
    const noTaper = [300, 325, 350, 375, 400, 425, 450, 475, 500, 520, 520, 520];
    const result = scorePlanDeterministic(
      planFromWeeklyTss(noTaper, { eventDate: addDays(START, 11 * 7 + 6) }),
      CTX
    );
    expect(result.ok).toBe(false);
  });
});
