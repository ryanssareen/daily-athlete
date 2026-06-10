import { describe, expect, it } from "vitest";
import type { IntensityTarget, WorkoutPhase } from "@da2/shared";

import { assessBlockCoherence, type CoherenceWorkout } from "../phase-coherence";

const Z2: IntensityTarget = { kind: "zone", value: 2 };
const Z5: IntensityTarget = { kind: "zone", value: 5 };

function w(date: string, phase: WorkoutPhase, it: IntensityTarget = Z2): CoherenceWorkout {
  return { scheduled_date: date, phase, intensity_target: it };
}

function coherentPhases(result: ReturnType<typeof assessBlockCoherence>) {
  return result.filter((b) => !b.coherent).map((b) => b.phase);
}

describe("assessBlockCoherence", () => {
  it("returns empty for no workouts", () => {
    expect(assessBlockCoherence([])).toEqual([]);
  });

  it("marks a well-ordered plan with quality + a soft taper as coherent", () => {
    const plan = [
      w("2026-06-01", "base"),
      w("2026-06-08", "build", Z5), // quality present
      w("2026-06-15", "peak", Z5),
      w("2026-06-22", "taper"), // easy only
    ];
    const result = assessBlockCoherence(plan);
    expect(result.every((b) => b.coherent)).toBe(true);
  });

  it("flags a build block that lost its quality sessions (the skip-drift case)", () => {
    const plan = [
      w("2026-06-01", "base"),
      w("2026-06-08", "build"), // all easy -> hollow build
      w("2026-06-09", "build"),
    ];
    expect(coherentPhases(assessBlockCoherence(plan))).toContain("build");
  });

  it("flags a taper block that gained a hard session", () => {
    const plan = [
      w("2026-06-01", "build", Z5),
      w("2026-06-20", "taper", Z5), // hard session moved into the taper
    ];
    expect(coherentPhases(assessBlockCoherence(plan))).toContain("taper");
  });

  it("flags a phase scheduled out of canonical order", () => {
    const plan = [
      w("2026-06-01", "base"),
      w("2026-06-08", "taper"),
      w("2026-06-15", "build", Z5), // build after the taper started
    ];
    expect(coherentPhases(assessBlockCoherence(plan))).toContain("build");
  });

  it("is purely observational — it returns a verdict, never throws or mutates", () => {
    const plan = [w("2026-06-01", "base")];
    const copy = JSON.parse(JSON.stringify(plan));
    assessBlockCoherence(plan);
    expect(plan).toEqual(copy);
  });
});
