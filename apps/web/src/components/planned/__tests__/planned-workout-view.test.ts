import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { PlannedDetailRow } from "@/db/workouts";

import {
  buildPlannedWorkoutView,
  NO_INTENSITY_TARGET_TEXT,
  NOT_SET_TEXT,
} from "@/components/planned/planned-workout-view";

function makeRow(overrides: Partial<PlannedDetailRow> = {}): PlannedDetailRow {
  return {
    id: "workout-1",
    scheduled_date: "2026-08-30",
    sport: "run",
    status: "planned",
    structure: {},
    edited_by_kind: null,
    rationale: null,
    planned_load: null,
    ...overrides,
  };
}

describe("buildPlannedWorkoutView", () => {
  it("renders no rationale when null", () => {
    const view = buildPlannedWorkoutView(makeRow({ rationale: null }));
    expect(view.rationale).toBeNull();
  });

  it("renders no rationale when absent (blank string)", () => {
    const view = buildPlannedWorkoutView(makeRow({ rationale: "   " }));
    expect(view.rationale).toBeNull();
  });

  it("renders rationale text when present", () => {
    const view = buildPlannedWorkoutView(makeRow({ rationale: "Building aerobic base." }));
    expect(view.rationale).toBe("Building aerobic base.");
  });

  it("passes an HTML-like description through as a literal string, never stripped/interpreted", () => {
    const scriptLike = '<script>alert("xss")</script>';
    const view = buildPlannedWorkoutView(
      makeRow({ structure: { description: scriptLike } })
    );
    expect(view.description).toBe(scriptLike);
  });

  it("renders the 'Not set' fallback when duration is unresolvable", () => {
    const view = buildPlannedWorkoutView(makeRow({ structure: { phase: "taper" } }));
    expect(view.durationDisplay).toBe(NOT_SET_TEXT);
  });

  it("renders the 'Not set' fallback when load is unresolvable", () => {
    const view = buildPlannedWorkoutView(
      makeRow({ structure: { duration_s: 1800 }, planned_load: null })
    );
    expect(view.loadDisplay).toBe(NOT_SET_TEXT);
  });

  it("renders a resolved load", () => {
    const view = buildPlannedWorkoutView(
      makeRow({ structure: { duration_s: 1800 }, planned_load: 42 })
    );
    expect(view.loadDisplay).toBe("42 load");
  });

  it("renders the 'No target set' fallback for free-text intensity", () => {
    const view = buildPlannedWorkoutView(
      makeRow({ structure: { intensity_target: "hard effort, RPE 8" } })
    );
    expect(view.intensityDisplay).toBe(NO_INTENSITY_TARGET_TEXT);
  });

  it("renders the 'No target set' fallback when intensity is absent", () => {
    const view = buildPlannedWorkoutView(makeRow({ structure: { duration_s: 1800 } }));
    expect(view.intensityDisplay).toBe(NO_INTENSITY_TARGET_TEXT);
  });

  it("renders a resolved intensity target", () => {
    const view = buildPlannedWorkoutView(
      makeRow({ structure: { intensity_target: { kind: "zone", value: 3 } } })
    );
    expect(view.intensityDisplay).toBe("Zone 3");
  });

  it("returns null steps when structure carries no blocks/sets array", () => {
    const view = buildPlannedWorkoutView(makeRow({ structure: { duration_s: 1800 } }));
    expect(view.steps).toBeNull();
  });

  it("derives a step list from a legacy blocks array, dropping non-allow-listed fields", () => {
    const view = buildPlannedWorkoutView(
      makeRow({
        structure: {
          blocks: [
            {
              label: "Warm-up",
              duration_s: 600,
              intensity_target: { kind: "zone", value: 1 },
              color: "blue",
            },
          ],
        },
      })
    );
    expect(view.steps).toEqual([
      { label: "Warm-up", durationDisplay: "10m", intensityDisplay: "Zone 1" },
    ]);
  });

  it("drops a legacy entry with none of label/duration/intensity present", () => {
    const view = buildPlannedWorkoutView(
      makeRow({
        structure: {
          sets: [
            { label: "Cool-down", duration_s: 300 },
            { color: "red", weird_field: 123 },
          ],
        },
      })
    );
    expect(view.steps).toEqual([
      { label: "Cool-down", durationDisplay: "5m", intensityDisplay: null },
    ]);
  });
});

describe("page.tsx never uses dangerouslySetInnerHTML (R7 safety check)", () => {
  it("the planned detail page source contains no dangerouslySetInnerHTML", () => {
    const pagePath = path.resolve(
      __dirname,
      "../../../../app/(athlete)/athlete/planned/[id]/page.tsx"
    );
    const source = readFileSync(pagePath, "utf-8");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });
});
