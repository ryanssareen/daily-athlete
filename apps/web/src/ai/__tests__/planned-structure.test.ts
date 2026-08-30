// Golden-fixture tests for the defensive `planned_workouts.structure` readers
// (src/ai/planned-structure.ts) and the KTD6 intensity display formatter
// (src/components/planned/planned-workout-view.ts).
//
// Both this file and daily-athlete/test/models/planned_structure_test.dart
// (a parallel unit, U2) load the SAME rows from
// packages/shared/test-fixtures/planned-structure-vectors.json so the
// TypeScript and Dart readers/formatters cannot silently disagree (KTD2a).
// Do not hand-write separate expectations here -- assert against the shared
// fixture's fields directly.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  readStructureDurationSeconds,
  readStructureIntensityTarget,
  readStructureLoad,
} from "@/ai/planned-structure";
import {
  extractLegacySteps,
  formatIntensityTarget,
} from "@/components/planned/planned-workout-view";

const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../../../packages/shared/test-fixtures/planned-structure-vectors.json"
);

interface DurationLoadIntensityRow {
  name: string;
  structure_input: Record<string, unknown>;
  planned_load_column: number | null;
  expected_duration_s: number | null;
  expected_load: number | null;
  expected_intensity_target: { kind: string; value: number } | null;
  expected_display_string: string | null;
}

interface LegacyStepExpectation {
  label: string | null;
  duration_s: number | null;
  display_string: string | null;
}

interface LegacyStepsRow {
  name: string;
  structure_input: Record<string, unknown>;
  expected_steps: LegacyStepExpectation[];
}

interface Fixture {
  duration_load_intensity: DurationLoadIntensityRow[];
  legacy_steps: LegacyStepsRow[];
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as Fixture;

describe("planned-structure readers (KTD2a golden fixture)", () => {
  for (const row of fixture.duration_load_intensity) {
    it(row.name, () => {
      expect(readStructureDurationSeconds(row.structure_input)).toBe(row.expected_duration_s);
      expect(readStructureLoad(row.structure_input, row.planned_load_column)).toBe(
        row.expected_load
      );
      expect(readStructureIntensityTarget(row.structure_input)).toEqual(
        row.expected_intensity_target
      );

      const intensityTarget = readStructureIntensityTarget(row.structure_input);
      expect(formatIntensityTarget(intensityTarget)).toBe(row.expected_display_string);
    });
  }
});

describe("legacy step extraction (KTD5 golden fixture)", () => {
  for (const row of fixture.legacy_steps) {
    it(row.name, () => {
      const steps = extractLegacySteps(row.structure_input);
      expect(steps).toEqual(row.expected_steps);
    });
  }
});
