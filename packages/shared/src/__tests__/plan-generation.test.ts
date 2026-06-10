import { describe, expect, it } from "vitest";

import {
  GeneratePlanInputSchema,
  GeneratedPlanSchema,
  GeneratedWorkoutSchema,
  GeneratedWorkoutStructureSchema,
  isFutureEventDate,
} from "../plan-generation";

const ATHLETE = "00000000-0000-0000-0000-0000000000a1";

function validWorkout() {
  return {
    scheduled_date: "2026-07-01",
    sport: "run" as const,
    structure: {
      duration_s: 3600,
      load: 50,
      intensity_target: { kind: "zone" as const, value: 2 },
      phase: "base" as const,
    },
    rationale: "Aerobic base session.",
    planned_load: 50,
  };
}

describe("GeneratePlanInputSchema", () => {
  it("parses a minimal input and applies defaults", () => {
    const parsed = GeneratePlanInputSchema.parse({
      athlete_id: ATHLETE,
      weekly_hours: 8,
    });
    expect(parsed.mode).toBe("standard");
    expect(parsed.injury_history).toBe("");
    expect(parsed.event_type).toBeNull();
    expect(parsed.event_date).toBeNull();
  });

  it("rejects an unknown key (strict) and an out-of-range weekly_hours", () => {
    expect(
      GeneratePlanInputSchema.safeParse({
        athlete_id: ATHLETE,
        weekly_hours: 8,
        surprise: true,
      }).success
    ).toBe(false);
    expect(
      GeneratePlanInputSchema.safeParse({ athlete_id: ATHLETE, weekly_hours: 99 })
        .success
    ).toBe(false);
  });

  it("caps injury_history free text", () => {
    expect(
      GeneratePlanInputSchema.safeParse({
        athlete_id: ATHLETE,
        weekly_hours: 8,
        injury_history: "x".repeat(5000),
      }).success
    ).toBe(false);
  });
});

describe("GeneratedPlanSchema", () => {
  it("parses a representative plan", () => {
    const parsed = GeneratedPlanSchema.parse({
      event_type: "Olympic triathlon",
      event_date: "2026-09-01",
      narrative: "A 12-week build to your A-race.",
      workouts: [validWorkout()],
    });
    expect(parsed.workouts).toHaveLength(1);
    expect(parsed.workouts[0].structure.phase).toBe("base");
  });

  it("rejects an empty workout list", () => {
    expect(
      GeneratedPlanSchema.safeParse({
        event_type: null,
        event_date: null,
        workouts: [],
      }).success
    ).toBe(false);
  });

  it("rejects an unexpected (possibly injected) structure key", () => {
    const w = validWorkout();
    const bad = { ...w, structure: { ...w.structure, evil: "<script>" } };
    expect(
      GeneratedPlanSchema.safeParse({
        event_type: null,
        event_date: null,
        workouts: [bad],
      }).success
    ).toBe(false);
  });
});

describe("GeneratedWorkoutStructureSchema", () => {
  it("requires the frozen fields with their units", () => {
    expect(
      GeneratedWorkoutStructureSchema.safeParse({
        load: 50,
        intensity_target: { kind: "zone", value: 2 },
        phase: "base",
      }).success
    ).toBe(false); // missing duration_s
    expect(
      GeneratedWorkoutStructureSchema.safeParse({
        duration_s: 60.5, // not an integer number of seconds
        load: 50,
        intensity_target: { kind: "zone", value: 2 },
        phase: "base",
      }).success
    ).toBe(false);
  });
});

describe("GeneratedWorkoutSchema — planned_load / structure.load invariant", () => {
  it("accepts a workout whose planned_load equals structure.load", () => {
    expect(GeneratedWorkoutSchema.safeParse(validWorkout()).success).toBe(true);
  });

  it("rejects a workout where planned_load diverges from structure.load", () => {
    // The safety validator forward-simulates from planned_load while the adaptive
    // engine re-seeds from structure.load; a divergence could slip an unsafe load
    // past the gate, so the schema must reject it at the trust boundary.
    const w = validWorkout();
    const diverged = {
      ...w,
      planned_load: 5,
      structure: { ...w.structure, load: 600 },
    };
    expect(GeneratedWorkoutSchema.safeParse(diverged).success).toBe(false);
  });
});

describe("isFutureEventDate", () => {
  it("compares YYYY-MM-DD chronologically", () => {
    expect(isFutureEventDate("2026-09-01", "2026-06-08")).toBe(true);
    expect(isFutureEventDate("2026-06-01", "2026-06-08")).toBe(false);
    expect(isFutureEventDate("2026-06-08", "2026-06-08")).toBe(false);
  });
});
