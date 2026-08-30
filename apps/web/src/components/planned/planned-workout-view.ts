// Pure view logic for the planned-workout detail page (U1).
//
// Colocated under components/planned/ rather than src/ai/ -- this mirrors
// src/components/period-review/review-view.ts and src/adaptive/proposal-view.ts:
// pure functions, no React, no I/O, testable under this repo's Node-only
// vitest environment (no jsdom). Only page-specific composition lives here.
//
// Duration/load/intensity/step NORMALIZATION is not reimplemented here -- it
// lives once in src/ai/planned-structure.ts (readStructureDurationSeconds /
// readStructureLoad / readStructureIntensityTarget / formatIntensityTarget /
// extractLegacySteps), alongside the other readers rather than in page-glue,
// so a future non-UI consumer has the same one shared contract to import
// (see the plan's High-Level Technical Design). This file only assembles
// that output into the shape the page renders, plus the duration/load
// fallback-copy decisions that are specific to this page.

import {
  extractLegacySteps,
  formatIntensityTarget,
  readStructureDurationSeconds,
  readStructureIntensityTarget,
  readStructureLoad,
  type LegacyStepEntry,
} from "@/ai/planned-structure";
import { formatDuration } from "@/components/period-review/review-view";
import type { PlannedDetailRow } from "@/db/workouts";

export const NOT_SET_TEXT = "Not set";
export const NO_INTENSITY_TARGET_TEXT = "No target set";

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/**
 * Formatted duration for display, e.g. "1h 30m" / "45m". "Not set" when the
 * structure carries none of the three known duration spellings (or the value
 * is non-finite / non-positive) -- unlike `formatDuration`'s own "0m" for
 * that case, which is right for a period-review delta but wrong here: this
 * page needs to distinguish "no duration was ever prescribed" from "a
 * duration of zero," so the null-check wraps the shared arithmetic rather
 * than duplicating it.
 */
export function formatDurationDisplay(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return NOT_SET_TEXT;
  return formatDuration(seconds);
}

/** Formatted load for display. "Not set" when neither `structure.load` nor
 * the `planned_load` column carries a value. */
export function formatLoadDisplay(load: number | null): string {
  if (load == null || !Number.isFinite(load)) return NOT_SET_TEXT;
  return `${Math.round(load)} load`;
}

// ---------------------------------------------------------------------------
// Page-ready view model
// ---------------------------------------------------------------------------

/** One step, ready to render. */
export interface PlannedStepView {
  label: string | null;
  durationDisplay: string;
  intensityDisplay: string | null;
}

export interface PlannedWorkoutView {
  /** AI-authored rationale text, or null when absent/blank. Render as plain
   * text -- never `dangerouslySetInnerHTML` (R7). */
  rationale: string | null;
  /** `structure.description`, or null when absent/blank. Render as plain
   * text -- never `dangerouslySetInnerHTML` (R7). */
  description: string | null;
  /** "Not set" fallback when unresolvable. */
  durationDisplay: string;
  /** "Not set" fallback when unresolvable. */
  loadDisplay: string;
  /** "No target set" fallback when intensity is free-text or absent. */
  intensityDisplay: string;
  /** Best-effort legacy step list, or null when `structure` carries no
   * `blocks`/`sets` array to derive one from. */
  steps: PlannedStepView[] | null;
}

function readStructureDescription(
  structure: Record<string, unknown> | null | undefined
): string | null {
  if (!structure) return null;
  const v = structure.description;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function toStepView(entry: LegacyStepEntry): PlannedStepView {
  return {
    label: entry.label,
    durationDisplay: formatDurationDisplay(entry.duration_s),
    intensityDisplay: entry.display_string,
  };
}

/** Builds every display value the planned-workout detail page needs from a
 * fetched row. Pure -- no I/O, no React. */
export function buildPlannedWorkoutView(row: PlannedDetailRow): PlannedWorkoutView {
  const structure = row.structure;
  const durationSeconds = readStructureDurationSeconds(structure);
  const load = readStructureLoad(structure, row.planned_load);
  const intensityTarget = readStructureIntensityTarget(structure);
  const rawSteps = extractLegacySteps(structure);

  return {
    rationale: typeof row.rationale === "string" && row.rationale.trim() ? row.rationale.trim() : null,
    description: readStructureDescription(structure),
    durationDisplay: formatDurationDisplay(durationSeconds),
    loadDisplay: formatLoadDisplay(load),
    intensityDisplay: formatIntensityTarget(intensityTarget) ?? NO_INTENSITY_TARGET_TEXT,
    steps: rawSteps == null ? null : rawSteps.map(toStepView),
  };
}
