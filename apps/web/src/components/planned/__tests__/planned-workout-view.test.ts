import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { PlannedDetailRow } from "@/db/workouts";

import {
  buildPlannedWorkoutView,
  formatDurationDisplay,
  NO_INTENSITY_TARGET_TEXT,
  NOT_SET_TEXT,
  parseRationaleRuns,
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

describe("formatDurationDisplay", () => {
  it("renders 'Not set' for a negative value", () => {
    expect(formatDurationDisplay(-5)).toBe(NOT_SET_TEXT);
  });

  it("renders 'Not set' for NaN", () => {
    expect(formatDurationDisplay(Number.NaN)).toBe(NOT_SET_TEXT);
  });

  it("renders 'Not set' for zero", () => {
    expect(formatDurationDisplay(0)).toBe(NOT_SET_TEXT);
  });
});

describe("parseRationaleRuns", () => {
  it("returns a single unbolded run for plain text", () => {
    expect(parseRationaleRuns("Easy aerobic run.")).toEqual([
      { text: "Easy aerobic run.", bold: false },
    ]);
  });

  it("splits a leading **bold** span from the rest", () => {
    expect(parseRationaleRuns("**Home strength circuit.** 3 rounds.")).toEqual([
      { text: "Home strength circuit.", bold: true },
      { text: " 3 rounds.", bold: false },
    ]);
  });

  it("handles multiple bold spans with plain text between and after", () => {
    expect(parseRationaleRuns("**A** middle **B** end")).toEqual([
      { text: "A", bold: true },
      { text: " middle ", bold: false },
      { text: "B", bold: true },
      { text: " end", bold: false },
    ]);
  });

  it("leaves an unterminated ** as literal plain text (no partial match)", () => {
    expect(parseRationaleRuns("half **bold with no closer")).toEqual([
      { text: "half **bold with no closer", bold: false },
    ]);
  });

  it("preserves embedded newlines within a run (caller applies white-space: pre-wrap)", () => {
    expect(parseRationaleRuns("**Header.**\n\n- item one\n- item two")).toEqual([
      { text: "Header.", bold: true },
      { text: "\n\n- item one\n- item two", bold: false },
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
