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
