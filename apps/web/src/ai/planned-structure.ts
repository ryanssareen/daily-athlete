import "server-only";

// Defensive readers over `planned_workouts.structure` JSONB.
//
// `PlannedWorkoutStructureSchema` is `.passthrough()` with only `phase`
// guaranteed, so a coach-authored, hand-edited, or model-generated structure
// may be missing any given key or spell it differently. Every consumer that
// wants a prescribed number out of that blob needs the same defensive reads,
// and getting them wrong is not a cosmetic bug -- see the duration comment
// below for the production incident it caused.
//
// Extracted from apps/web/src/ai/reports/context.ts, which had the only copy
// until the period-review aggregation engine needed the identical reads. It
// lives here rather than in either consumer so the THREE-SPELLING knowledge
// below has exactly one home. A second copy would drift, and the drift would
// be silent: the wrong answer is "unavailable", which looks like missing data
// rather than a bug.

import { IntensityTargetSchema, type IntensityTarget } from "@da2/shared";

/**
 * Read a finite number off a structure blob. Anything absent, non-numeric, or
 * non-finite reads as null -- callers degrade that dimension rather than
 * propagating a NaN into arithmetic.
 */
export function readStructureNumber(
  structure: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  if (!structure) return null;
  const v = structure[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Prescribed duration in SECONDS, across every spelling that exists in
 * production `planned_workouts.structure` payloads.
 *
 * The generation prompt asks for `duration_s`, but a survey of live rows found
 * THREE spellings in use, each from a different writer, and no row carrying
 * more than one:
 *
 *   duration_s          seconds  -- what the prompt asks for
 *   est_duration_min    minutes  -- alongside a sport-specific `sets` array
 *   total_duration_min  minutes  -- alongside a `blocks` array and `ftp_w`
 *
 * Reading only `duration_s` left the duration dimension "unavailable" on most
 * real matched workouts, which cascaded into a `partial_data` verdict for
 * workouts that were perfectly scoreable -- the single biggest cause of an
 * empty-feeling report in production. Covering all three takes duration
 * coverage to 100% of the planned workouts that exist.
 *
 * This is a READ-SIDE accommodation of a write-side inconsistency, not an
 * endorsement of it; the durable fix is for generation to settle on one key.
 * Until then the reports should score what the athlete actually has.
 *
 * Minutes are converted here, at the read boundary, so every downstream
 * consumer keeps working in seconds and no unit ambiguity escapes this file.
 */
const DURATION_MINUTE_KEYS = ["est_duration_min", "total_duration_min"] as const;

export function readStructureDurationSeconds(
  structure: Record<string, unknown> | null | undefined,
): number | null {
  const seconds = readStructureNumber(structure, "duration_s");
  if (seconds != null) return seconds;
  for (const key of DURATION_MINUTE_KEYS) {
    const minutes = readStructureNumber(structure, key);
    if (minutes != null) return minutes * 60;
  }
  return null;
}

/** Prescribed load, preferring the structure's own `load` over the column.
 * Returns null when neither is present, so the caller degrades the load
 * dimension instead of scoring against a phantom zero. */
export function readStructureLoad(
  structure: Record<string, unknown> | null | undefined,
  plannedLoadColumn: number | null,
): number | null {
  return readStructureNumber(structure, "load") ?? plannedLoadColumn;
}

/** The prescribed intensity target, when the structure carries one in the
 * frozen `IntensityTargetSchema` shape. Free-text intensity (which production
 * also contains) parses as null rather than being coerced. */
export function readStructureIntensityTarget(
  structure: Record<string, unknown> | null | undefined,
): IntensityTarget | null {
  if (!structure) return null;
  const parsed = IntensityTargetSchema.safeParse(structure.intensity_target);
  return parsed.success ? parsed.data : null;
}

/**
 * Formats a resolved `IntensityTarget` for display: "N% FTP", "Zone N", or
 * "M:SS/km pace" (e.g. "4:30/km pace" for 270 seconds) -- the pace format
 * matches the athlete-facing convention (R3), not raw seconds. Returns null
 * (not a fallback string) when there is no target; the fallback text is each
 * caller's decision, since different call sites render "no target" differently.
 *
 * KTD6: verified against `packages/shared/test-fixtures/planned-structure-vectors.json`'s
 * `expected_display_string` column so this can't silently disagree with the
 * Dart port's formatter (planned_structure.dart).
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
 * of `label`/`name`/`description`), a duration (via `readStructureDurationSeconds`
 * applied to that single entry object), and an intensity (via
 * `readStructureIntensityTarget` + `formatIntensityTarget`, applied to that
 * single entry object). Any other field (color, icon, notes, etc.) is
 * ignored. An entry where all three resolve to nothing is dropped entirely,
 * not rendered as an empty/blank step.
 *
 * Returns null when `structure` carries neither array at all (nothing to
 * render, as opposed to "rendered, but empty"). Lives alongside the other
 * readers, not in a page-specific view-model, so this is one shared contract
 * per platform (see the plan's High-Level Technical Design) rather than UI
 * glue a future non-UI consumer would have no natural import for.
 */
export function extractLegacySteps(
  structure: Record<string, unknown> | null | undefined,
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
