// Contract-anchor test: the generated `structure` must be a SUPERSET of the
// frozen edit-op StructureChange subset with IDENTICAL units, and must read
// back through the (backward-compatible) PlannedWorkoutStructureSchema. This is
// the integration assertion the adaptive fixture header
// (apps/web/src/ai/adaptive/__fixtures__/structure.ts) calls for.

import { describe, expect, it } from "vitest";
import {
  GeneratedWorkoutStructureSchema,
  MAX_STRUCTURE_BYTES,
  PlannedWorkoutStructureSchema,
  StructureChangeSchema,
} from "@da2/shared";

import { fixturePlannedWorkout, FIXTURE_WORKOUT_IDS } from "@/ai/adaptive/__fixtures__/structure";

describe("structure contract — backward compatibility", () => {
  it("parses the adaptive fixture structure (the frozen subset)", () => {
    const wk = fixturePlannedWorkout({ id: FIXTURE_WORKOUT_IDS.easyRun });
    expect(PlannedWorkoutStructureSchema.safeParse(wk.structure).success).toBe(true);
  });

  it("parses a bare legacy `{}` structure", () => {
    expect(PlannedWorkoutStructureSchema.safeParse({}).success).toBe(true);
  });

  it("rejects a structure larger than the size cap", () => {
    const huge = { blob: "x".repeat(MAX_STRUCTURE_BYTES + 100) };
    expect(PlannedWorkoutStructureSchema.safeParse(huge).success).toBe(false);
  });
});

describe("structure contract — generated is a StructureChange superset", () => {
  const generated = GeneratedWorkoutStructureSchema.parse({
    duration_s: 3600,
    load: 50,
    intensity_target: { kind: "zone", value: 2 },
    phase: "build",
    description: "4x4min @ threshold",
  });

  it("yields a valid StructureChange when projected onto the frozen fields", () => {
    const projected = {
      duration_s: generated.duration_s,
      load: generated.load,
      intensity_target: generated.intensity_target,
    };
    const parsed = StructureChangeSchema.safeParse(projected);
    expect(parsed.success).toBe(true);
    // Units are identical: duration is integer SECONDS, load is TSS-equivalent.
    expect(generated.duration_s).toBe(3600);
    expect(generated.load).toBe(50);
  });

  it("reads back through PlannedWorkoutStructureSchema (generated rows parse)", () => {
    expect(PlannedWorkoutStructureSchema.safeParse(generated).success).toBe(true);
  });
});
