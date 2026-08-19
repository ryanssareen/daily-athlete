// Deterministic execution-delta engine (Unit U3,
// docs/plans/2026-08-18-001-feat-workout-reports-plan.md).
//
// `computeExecutionDelta(input)` is a PURE FUNCTION: no I/O, no clock, no
// Supabase client, no LLM. Per KTD1 the verdict is arithmetic -- only the
// narrative (Unit U5) is AI-written, and it is handed this function's output
// rather than raw payloads. Per KTD2 the delta is computed on every read, so
// it has no persistence and no staleness problem of its own.
//
// KTD8: every dimension degrades INDEPENDENTLY. Missing data on either side
// of a comparison yields `{status: "unavailable"}` -- never a throw, never
// `NaN`, never `Infinity`. `matched: false` short-circuits straight to the
// `{matched: false, verdict}` branch with `unplanned_effort` -- this is the
// entire implementation of R4 (unplanned/unmatched effort); no other branch
// in this module special-cases the unmatched case.
//
// KTD7: thresholds come from the workout's SNAPSHOTTED `summary_stats`
// (`ftp_at_workout`, `hr_max_at_workout`), never a live/current threshold --
// that is what makes the comparison historically correct for old workouts
// even after the athlete's current FTP/HRmax has moved on.

import type {
  DimensionDelta,
  ExecutionDelta,
  ExecutionDeltaDimensions,
  IntensityDimensionDelta,
  IntensityTarget,
  Verdict,
  VerdictCode,
} from "@da2/shared";

// ---------------------------------------------------------------------------
// Tolerance bands -- product judgment (see plan Risks: "first guess, will
// need tuning"). Centralized here, named, so tuning is a one-file change.
// ---------------------------------------------------------------------------

/** Duration is "on target" within this +/- percent band. Boundary is INCLUSIVE. */
export const DURATION_TOLERANCE_PCT = 10;
/**
 * Load/TSS is noisier across sports and estimation methods (power-derived vs
 * duration-proxy) than a clean duration comparison, so its band is wider.
 * Boundary is INCLUSIVE.
 */
export const LOAD_TOLERANCE_PCT = 15;
/**
 * Intensity (the point of the prescription, per AE1's "avg power within
 * band") gets the tightest band. Boundary is INCLUSIVE.
 */
export const INTENSITY_TOLERANCE_PCT = 8;

/**
 * Finite stand-in for `deltaPct` when `prescribed === 0` but `actual !== 0`
 * (e.g. a zero-load recovery day the athlete rode anyway). The "true"
 * percent delta from a zero baseline is undefined (division by zero); this
 * sentinel keeps `deltaPct` schema-`.finite()`-compliant (per
 * `packages/shared/src/workout-report.ts`) while still preserving direction
 * (positive = the athlete did more than the zero prescription, negative =
 * impossible in practice but handled symmetrically for completeness).
 */
export const ZERO_PRESCRIBED_DELTA_PCT_SENTINEL = 100;

/**
 * Midpoint %HRmax used to resolve an `{kind: "zone", value: 1-7}` intensity
 * target into a comparable number against `hr_max_at_workout` (KTD7). This
 * is NOT the per-athlete-configurable zones model KTD7 defers (that
 * structure does not exist on `athlete_profiles.baselines.per_sport`) -- it
 * is a fixed, generic 7-zone breakdown internal to this comparison, exactly
 * as much a "first guess, will need tuning" product judgment as the
 * tolerance bands above, so it lives here as a named, centralized constant
 * rather than inline.
 */
export const ZONE_MIDPOINT_PCT_HR_MAX: Readonly<Record<number, number>> = {
  1: 55, // Active recovery
  2: 65, // Endurance
  3: 75, // Tempo
  4: 85, // Threshold
  5: 92, // VO2 max approach
  6: 98, // VO2 max / near-max
  7: 100, // Max effort / neuromuscular (HR ceiling)
};

// Field-preference order for reading a computed actual value out of
// `summary_stats`, which carries two naming generations (see
// `packages/shared/src/completed-workout.ts` header). Centralized here so
// the preference order is a one-place fact, not scattered `??` chains.
//
// `tss_equivalent` is the CANONICAL key and must be read first; `tss` is the
// currently-stored legacy name. This order is not arbitrary -- it mirrors
// `training-load/load-series.ts` (persistedTss). If the two modules disagreed,
// a workout carrying both keys would report a different load here than in the
// athlete's CTL/ATL/TSB series, which is exactly the kind of inconsistency the
// report exists to avoid.
const LOAD_ACTUAL_KEYS = ["tss_equivalent", "tss"] as const;
const POWER_ACTUAL_KEYS = [
  "normalized_power_w",
  "weighted_average_watts",
  "avg_power_w",
  "average_watts",
] as const;
const HR_ACTUAL_KEYS = ["avg_hr_bpm", "average_heartrate"] as const;
// `avg_pace_s_per_km` is the canonical key SummaryStatsSchema declares
// (packages/shared/src/completed-workout.ts) -- but NOTHING in the ingest
// path writes it today: strava/build-summary-stats.ts stores Strava's
// `average_speed` (metres per second) instead, and a manual entry stores
// neither. Reading only the canonical key therefore made every
// `pace_s_per_km` intensity target resolve to "unavailable" in practice --
// the dimension existed but could never fire. `resolvePaceSecPerKm` below
// falls back through the two representations that DO exist, so a run
// prescribed by pace is actually compared.
const PACE_ACTUAL_KEYS = ["avg_pace_s_per_km"] as const;
const SPEED_ACTUAL_KEYS = ["average_speed", "avg_speed_m_s"] as const;
const METRES_PER_KM = 1000;

// ---------------------------------------------------------------------------
// Input contract -- the narrow, structural view this function reads.
//
// U4 (context assembly, running in parallel) owns the real
// `gatherReportContext` return shape; this interface is deliberately the
// minimal structural subset THIS function depends on, so U4 (and U6, which
// wires U3+U4 together) can satisfy it with whatever richer object they
// build without this module importing their types.
// ---------------------------------------------------------------------------

/** The completed workout's fields this engine reads. */
export interface DeltaCompletedWorkoutInput {
  duration_s: number | null;
  /** Read by `resolvePaceSecPerKm`'s last-resort branch (distance + duration
   *  when neither a stored pace nor a stored speed exists), and carried on
   *  for reuse by the fact-sheet/narration layer (Unit U5). */
  distance_m: number | null;
  sport: string;
  /** `SummaryStats` is `.passthrough()`; a plain index is all this module needs. */
  summary_stats: Record<string, unknown>;
}

/** The subset of `PlannedWorkoutStructureSchema` (`.passthrough()`) this engine reads. */
export interface DeltaPlannedStructureInput {
  duration_s?: number;
  load?: number;
  intensity_target?: IntensityTarget;
}

/** The matched planned workout's fields this engine reads. */
export interface DeltaPlannedWorkoutInput {
  sport: string;
  planned_load: number | null;
  structure: DeltaPlannedStructureInput;
}

/**
 * Discriminated on `matched`, mirroring `ExecutionDelta`'s own shape (see
 * `packages/shared/src/workout-report.ts`) -- an unmatched input carries no
 * `planned` at all, which is what makes "matched: false short-circuits every
 * dimension" a structural guarantee rather than a runtime null-check.
 */
export type DeltaInput =
  | { matched: true; completed: DeltaCompletedWorkoutInput; planned: DeltaPlannedWorkoutInput }
  | { matched: false; completed: DeltaCompletedWorkoutInput };

// ---------------------------------------------------------------------------
// Small numeric helpers (mirrors `apps/web/src/training-load/load-series.ts`'s
// `readNumber` shape/naming -- the pattern this module was asked to follow).
// ---------------------------------------------------------------------------

function readNumber(stats: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!stats) return null;
  const v = stats[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readFirstNumber(
  stats: Record<string, unknown> | null | undefined,
  keys: readonly string[]
): number | null {
  for (const key of keys) {
    const v = readNumber(stats, key);
    if (v != null) return v;
  }
  return null;
}

/** Narrows to a finite number or null -- never lets a stray NaN/Infinity through. */
function finiteOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Percent delta of `actual` vs `prescribed`, always finite (KTD8 / the
 * schema's `.finite()` requirement on `deltaPct`).
 *
 * `invert`: when true, a LOWER `actual` than `prescribed` counts as "did
 * more" (positive delta). Used for `pace_s_per_km`, where a smaller
 * seconds-per-km value means a FASTER, harder effort -- the opposite
 * direction from duration/load/%FTP/%HRmax, where a bigger number means
 * more was done.
 */
function computeDeltaPct(prescribed: number, actual: number, invert = false): number {
  if (prescribed === 0) {
    if (actual === 0) return 0;
    const didMore = invert ? actual < prescribed : actual > prescribed;
    return didMore ? ZERO_PRESCRIBED_DELTA_PCT_SENTINEL : -ZERO_PRESCRIBED_DELTA_PCT_SENTINEL;
  }
  const signedRaw = invert ? prescribed - actual : actual - prescribed;
  return (signedRaw / prescribed) * 100;
}

function classifyStatus(deltaPct: number, tolerancePct: number): "on_target" | "under" | "over" {
  if (Math.abs(deltaPct) <= tolerancePct) return "on_target";
  return deltaPct < 0 ? "under" : "over";
}

// ---------------------------------------------------------------------------
// Dimension builders
// ---------------------------------------------------------------------------

function scalarDimension(
  prescribed: number | null | undefined,
  actual: number | null | undefined,
  tolerancePct: number
): DimensionDelta {
  const p = finiteOrNull(prescribed ?? null);
  const a = finiteOrNull(actual ?? null);
  if (p == null || a == null) return { status: "unavailable" };
  const deltaPct = computeDeltaPct(p, a);
  const status = classifyStatus(deltaPct, tolerancePct);
  return { status, prescribed: p, actual: a, deltaPct };
}

/**
 * Actual average pace in seconds per kilometre, through every representation
 * the ingest path actually produces, most-direct first:
 *   1. `avg_pace_s_per_km`  -- the canonical key (nothing writes it yet).
 *   2. `average_speed` m/s  -- what Strava sync stores; 1000 / v.
 *   3. distance + duration  -- the last resort, true for a manual entry that
 *      carries both but no derived stats at all.
 * Returns null (dimension "unavailable", KTD8) when none resolve to a finite
 * positive pace -- never Infinity from a zero speed or a zero distance.
 */
function resolvePaceSecPerKm(completed: DeltaCompletedWorkoutInput): number | null {
  const direct = readFirstNumber(completed.summary_stats, PACE_ACTUAL_KEYS);
  if (direct != null && direct > 0) return direct;

  const speed = readFirstNumber(completed.summary_stats, SPEED_ACTUAL_KEYS);
  if (speed != null && speed > 0) return METRES_PER_KM / speed;

  const { distance_m, duration_s } = completed;
  if (distance_m != null && distance_m > 0 && duration_s != null && duration_s > 0) {
    return duration_s / (distance_m / METRES_PER_KM);
  }
  return null;
}

/** Resolves an intensity target into comparable prescribed/actual numbers, per KTD7. */
function resolveIntensity(
  target: IntensityTarget,
  completed: DeltaCompletedWorkoutInput
): { prescribed: number; actual: number; invert: boolean } | null {
  const stats = completed.summary_stats;
  switch (target.kind) {
    case "ftp_pct": {
      const ftp = readNumber(stats, "ftp_at_workout");
      const power = readFirstNumber(stats, POWER_ACTUAL_KEYS);
      if (ftp == null || ftp <= 0 || power == null) return null;
      return { prescribed: target.value, actual: (power / ftp) * 100, invert: false };
    }
    case "zone": {
      const hrMax = readNumber(stats, "hr_max_at_workout");
      const hr = readFirstNumber(stats, HR_ACTUAL_KEYS);
      const midpoint = ZONE_MIDPOINT_PCT_HR_MAX[target.value];
      if (hrMax == null || hrMax <= 0 || hr == null || midpoint == null) return null;
      return { prescribed: midpoint, actual: (hr / hrMax) * 100, invert: false };
    }
    case "pace_s_per_km": {
      const pace = resolvePaceSecPerKm(completed);
      if (pace == null) return null;
      // Lower s/km = faster = harder; invert so "did more effort" is positive,
      // matching the sign convention of the other two intensity kinds.
      return { prescribed: target.value, actual: pace, invert: true };
    }
  }
}

function intensityDimension(
  target: IntensityTarget | undefined,
  completed: DeltaCompletedWorkoutInput
): IntensityDimensionDelta {
  if (!target) return { status: "unavailable" };
  const resolved = resolveIntensity(target, completed);
  if (!resolved) return { status: "unavailable" };
  const deltaPct = computeDeltaPct(resolved.prescribed, resolved.actual, resolved.invert);
  const status = classifyStatus(deltaPct, INTENSITY_TOLERANCE_PCT);
  return { status, target, prescribed: resolved.prescribed, actual: resolved.actual, deltaPct };
}

// ---------------------------------------------------------------------------
// Verdict -- templated headline, never model-written.
// ---------------------------------------------------------------------------

type DimensionKey = "duration" | "load" | "intensity";

const DIMENSION_LABELS: Record<DimensionKey, string> = {
  duration: "duration",
  load: "load",
  intensity: "intensity",
};

interface DimensionEntry {
  key: DimensionKey;
  status: "on_target" | "under" | "over" | "unavailable";
  deltaPct: number | null;
}

function toEntry(key: DimensionKey, dim: DimensionDelta | IntensityDimensionDelta): DimensionEntry {
  if (dim.status === "unavailable") return { key, status: "unavailable", deltaPct: null };
  return { key, status: dim.status, deltaPct: dim.deltaPct };
}

function formatAbsPct(n: number): string {
  return `${Math.round(Math.abs(n))}%`;
}

function buildHeadline(code: VerdictCode, worst?: DimensionEntry, allDimsPresent = false): string {
  switch (code) {
    case "executed_as_prescribed":
      return "Executed as prescribed.";
    case "under_executed":
      return worst
        ? `Under-executed vs. plan — ${DIMENSION_LABELS[worst.key]} ${formatAbsPct(worst.deltaPct ?? 0)} below prescription.`
        : "Under-executed vs. plan.";
    case "over_executed":
      return worst
        ? `Over-executed vs. plan — ${DIMENSION_LABELS[worst.key]} ${formatAbsPct(worst.deltaPct ?? 0)} above prescription.`
        : "Over-executed vs. plan.";
    case "partial_data":
      return allDimsPresent
        ? "Mixed execution vs. plan — dimensions disagree."
        : "Not enough matched data to score this workout confidently.";
    case "unplanned_effort":
      return "Unplanned effort — no matching plan entry.";
  }
}

function computeVerdict(dimensions: ExecutionDeltaDimensions | null): Verdict {
  if (dimensions == null) {
    return { code: "unplanned_effort", headline: buildHeadline("unplanned_effort") };
  }

  const entries: DimensionEntry[] = [
    toEntry("duration", dimensions.duration),
    toEntry("load", dimensions.load),
    toEntry("intensity", dimensions.intensity),
  ];
  const available = entries.filter((e) => e.status !== "unavailable");
  const allDimsPresent = available.length === entries.length;

  if (available.length === 0) {
    return { code: "partial_data", headline: buildHeadline("partial_data", undefined, allDimsPresent) };
  }

  const offTarget = available.filter((e) => e.status !== "on_target");
  if (offTarget.length === 0) {
    return { code: "executed_as_prescribed", headline: buildHeadline("executed_as_prescribed") };
  }

  const directions = new Set(offTarget.map((e) => e.status));
  if (directions.size > 1) {
    // Available dimensions disagree (some under, some over) -- an
    // unavailable dimension, had it been present, might have been the
    // tiebreaker. Report as insufficient-confidence rather than guessing.
    return { code: "partial_data", headline: buildHeadline("partial_data", undefined, allDimsPresent) };
  }

  const direction = offTarget[0].status as "under" | "over";
  const worst = offTarget.reduce((a, b) => (Math.abs(b.deltaPct ?? 0) > Math.abs(a.deltaPct ?? 0) ? b : a));
  const code: VerdictCode = direction === "under" ? "under_executed" : "over_executed";
  return { code, headline: buildHeadline(code, worst) };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Pure, deterministic delta from prescribed vs actual (KTD1/KTD2). No I/O,
 * no clock, no Supabase client, no LLM. Same input twice returns a
 * deeply-equal result.
 */
export function computeExecutionDelta(input: DeltaInput): ExecutionDelta {
  if (!input.matched) {
    return { matched: false, verdict: computeVerdict(null) };
  }

  const { completed, planned } = input;
  const stats = completed.summary_stats;

  const duration = scalarDimension(planned.structure.duration_s, completed.duration_s, DURATION_TOLERANCE_PCT);
  const loadActual = readFirstNumber(stats, LOAD_ACTUAL_KEYS);
  // `structure.load` FIRST, `planned_load` column second. This preference
  // order is not a coin flip -- it is what the rest of the codebase already
  // treats as authoritative (context.ts's `load` accessor and
  // ai/adaptive/context.ts both read structure.load, falling back to the
  // column). Coach- and MCP-authored planned workouts carry their load in
  // `structure` and may leave the column null, so reading only the column
  // dropped the load dimension entirely for them -- or, worse, compared
  // against a column value the structure had since superseded.
  const loadPrescribed = planned.structure.load ?? planned.planned_load;
  const load = scalarDimension(loadPrescribed, loadActual, LOAD_TOLERANCE_PCT);
  const intensity = intensityDimension(planned.structure.intensity_target, completed);

  const dimensions: ExecutionDeltaDimensions = { duration, load, intensity };
  const verdict = computeVerdict(dimensions);

  return { matched: true, dimensions, verdict };
}
