// Pure view logic for the planned-workout detail page (U1).
//
// Colocated under components/planned/ rather than src/ai/ -- every existing
// file in src/ai/ is either `server-only` or a generation/deterministic-engine
// module, not a page-facing view-model. This mirrors
// src/components/period-review/review-view.ts and src/adaptive/proposal-view.ts:
// pure functions, no React, no I/O, testable under this repo's Node-only
// vitest environment (no jsdom).
//
// Duration/load/intensity NORMALIZATION is not reimplemented here -- it lives
// once in src/ai/planned-structure.ts (readStructureDurationSeconds /
// readStructureLoad / readStructureIntensityTarget) and this file only
// formats those readers' output, plus the two things that don't exist yet:
// the KTD5 legacy step extractor and the KTD6 intensity display formatter.

import type { IntensityTarget } from "@da2/shared";

import {
  readStructureDurationSeconds,
  readStructureIntensityTarget,
  readStructureLoad,
} from "@/ai/planned-structure";
import type { PlannedDetailRow } from "@/db/workouts";

export const NOT_SET_TEXT = "Not set";
export const NO_INTENSITY_TARGET_TEXT = "No target set";

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/**
 * Formatted duration for display, e.g. "1h 30m" / "45m". "Not set" when the
 * structure carries none of the three known duration spellings (or the value
 * is non-finite / non-positive).
 */
export function formatDurationDisplay(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return NOT_SET_TEXT;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Formatted load for display. "Not set" when neither `structure.load` nor
 * the `planned_load` column carries a value. */
export function formatLoadDisplay(load: number | null): string {
  if (load == null || !Number.isFinite(load)) return NOT_SET_TEXT;
  return `${Math.round(load)} load`;
}

/**
 * Formats a resolved `IntensityTarget`. Returns null (not a fallback string)
 * when there is no target -- the fallback text is the caller's decision,
 * because the top-level card and a legacy step render "no target" differently
 * (see `buildPlannedWorkoutView` vs `extractLegacySteps`).
 *
 * KTD6: verified against `packages/shared/test-fixtures/planned-structure-vectors.json`'s
 * `expected_display_string` column -- "N% FTP" / "Zone N" / "M:SS/km pace".
 * The pace format matches R3's worked example (`4:30/km pace`), not raw
 * seconds.
 */
export function formatIntensityTarget(target: IntensityTarget | null): string | null {
  if (!target) return null;
  switch (target.kind) {
    case "ftp_pct":
      return `${target.value}% FTP`;
    case "zone":
      return `Zone ${target.value}`;
    case "pace_s_per_km": {
      const m = Math.floor(target.value / 60);
      const s = Math.round(target.value % 60);
      return `${m}:${s.toString().padStart(2, "0")}/km pace`;
    }
  }
}

// ---------------------------------------------------------------------------
// KTD5 legacy step allow-list
// ---------------------------------------------------------------------------

/** One legacy `blocks`/`sets` entry's allow-listed fields, in the exact shape
 * asserted against `planned-structure-vectors.json`'s `legacy_steps` rows. */
export interface LegacyStepEntry {
  label: string | null;
  duration_s: number | null;
  display_string: string | null;
}

const LEGACY_LABEL_KEYS = ["label", "name", "description"] as const;

function readLegacyLabel(entry: Record<string, unknown>): string | null {
  for (const key of LEGACY_LABEL_KEYS) {
    const v = entry[key];
    if (typeof v === "string") return v;
  }
  return null;
}

/**
 * KTD5: for each entry in a legacy `blocks` or `sets` array, read exactly
 * three allow-listed logical fields -- a label (first present, string-typed,
 * of `label`/`name`/`description`), a duration (via the shared duration
 * reader applied to that single entry object), and an intensity (via the
 * shared intensity reader, formatted the same way as the top-level
 * intensity). Any other field (color, icon, notes, etc.) is ignored. An
 * entry where all three resolve to nothing is dropped entirely, not rendered
 * as an empty/blank step.
 *
 * Returns null when `structure` carries neither array at all (nothing to
 * render, as opposed to "rendered, but empty").
 */
export function extractLegacySteps(
  structure: Record<string, unknown> | null | undefined
): LegacyStepEntry[] | null {
  if (!structure) return null;
  const raw = structure.blocks ?? structure.sets;
  if (!Array.isArray(raw)) return null;

  const steps: LegacyStepEntry[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;

    const label = readLegacyLabel(entry);
    const duration_s = readStructureDurationSeconds(entry);
    const intensityTarget = readStructureIntensityTarget(entry);
    const display_string = formatIntensityTarget(intensityTarget);

    if (label == null && duration_s == null && display_string == null) continue;
    steps.push({ label, duration_s, display_string });
  }
  return steps;
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
