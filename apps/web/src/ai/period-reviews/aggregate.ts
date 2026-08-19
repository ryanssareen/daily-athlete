// The deterministic period rollup (U3, KTD2).
//
// Every number an athlete reads in a period review, and every number the
// narration is handed, comes out of this function. The LLM never computes one.
//
// PURE -- no I/O, no ambient clock. Its inputs are already-fetched rows
// (context.ts, U4, does the reading) and its output is a `PeriodFacts` that
// parses against the shared schema.
//
// THE INVARIANT THIS MODULE DEFENDS: never emit a number it cannot justify.
// Concretely, three rules that recur throughout:
//
//   1. Unknown is null or "unavailable", never 0. A swim with no recorded
//      distance has UNKNOWN distance; rendering that as "0.0 km" is a lie the
//      athlete can read off a screen.
//   2. A percentage against a prescription of zero is undefined, not 0% and
//      not 100%. Those metrics degrade to "unavailable".
//   3. Each dimension degrades INDEPENDENTLY. A plan structure missing a
//      duration must not take the load comparison down with it -- the same
//      KTD8 discipline the per-workout delta engine follows.

import type {
  PeriodBounds,
  PeriodComparison,
  PeriodCompliance,
  PeriodFacts,
  PeriodKind,
  PeriodMetric,
  PeriodSportRollup,
  PeriodTotals,
  Sport,
} from "@da2/shared";
import { SportSchema } from "@da2/shared";

import { readStructureDurationSeconds, readStructureLoad } from "@/ai/planned-structure";
import { computeWorkoutTss, type LoadConfidence } from "@/training-load";

import { localDayInTimezone } from "./calendar";

// ---------------------------------------------------------------------------
// Input shapes (structural, not DB rows -- U4 projects into these)
// ---------------------------------------------------------------------------

export interface AggregateCompletedWorkout {
  id: string;
  sport: string;
  started_at: string;
  duration_s: number | null;
  distance_m: number | null;
  summary_stats: Record<string, unknown> | null;
  /** The `planned_workouts.id` this effort was matched to, or null when the
   * session was unplanned. */
  matched_planned_workout_id: string | null;
}

export interface AggregatePlannedWorkout {
  id: string;
  sport: string;
  scheduled_date: string;
  planned_load: number | null;
  structure: Record<string, unknown> | null;
}

export interface AggregateInput {
  kind: PeriodKind;
  periodKey: string;
  bounds: PeriodBounds;
  /** The athlete's IANA timezone -- active-day counting is local, not UTC. */
  timezone: string;
  completed: AggregateCompletedWorkout[];
  planned: AggregatePlannedWorkout[];
  /**
   * The preceding period, or null when there is none to compare against.
   *
   * Null and "empty" are DIFFERENT and the caller must not conflate them: null
   * means there is no prior period in the athlete's data at all (their first
   * ever week), and produces an ABSENT comparison. An empty `completed` array
   * means the prior period existed and they trained nothing in it, which is a
   * real and reportable -100%.
   */
  previous: { key: string; completed: AggregateCompletedWorkout[] } | null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Round to 2dp so the output is stable across floating-point noise -- two
 * structurally identical periods must produce byte-identical JSON (the
 * determinism test), and 0.30000000000000004 breaks that. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Percent change from `prescribed` to `actual`.
 *
 * Returns null when `prescribed` is 0: the change from nothing to something
 * has no percentage representation, and every alternative (0, 100, Infinity)
 * is a number the athlete would read as meaningful. The caller degrades the
 * metric instead.
 */
function percentChange(prescribed: number, actual: number): number | null {
  if (!Number.isFinite(prescribed) || !Number.isFinite(actual)) return null;
  if (prescribed === 0) return null;
  return round2(((actual - prescribed) / prescribed) * 100);
}

/** Tolerance band within which an aggregate counts as "on target". Wider than
 * a single session's, deliberately: hitting a week's total volume within a few
 * percent IS executing the plan, and flagging a 2% miss as under-execution
 * trains the athlete to ignore the verdict. */
const ON_TARGET_BAND_PCT = 5;

function toMetric(prescribed: number | null, actual: number): PeriodMetric {
  if (prescribed == null) return { status: "unavailable" };
  const deltaPct = percentChange(prescribed, actual);
  if (deltaPct == null) return { status: "unavailable" };

  const status =
    Math.abs(deltaPct) <= ON_TARGET_BAND_PCT ? "on_target" : deltaPct < 0 ? "under" : "over";
  return { status, prescribed: round2(prescribed), actual: round2(actual), deltaPct };
}

/** Coerce a stored sport string into the closed vocabulary. An unrecognized
 * value maps to "other" rather than failing the whole period -- the sport
 * column is plain TEXT and a review is not the right place to discover that. */
function toSport(raw: string): Sport {
  const parsed = SportSchema.safeParse(raw);
  return parsed.success ? parsed.data : "other";
}

/** Sum of a nullable field, or null when NO row carried a value. Distinguishes
 * "nobody recorded a distance" (null) from "everyone recorded zero" (0). */
function sumOrNull(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v != null && Number.isFinite(v));
  return present.length === 0 ? null : round2(present.reduce((a, b) => a + b, 0));
}

function durationOf(w: AggregateCompletedWorkout): number {
  return typeof w.duration_s === "number" && Number.isFinite(w.duration_s) && w.duration_s > 0
    ? w.duration_s
    : 0;
}

/** Load for one effort, reusing the shared training-load proxy rather than
 * re-deriving TSS. `null` means the effort carried no usable signal at all
 * (no TSS, no power, no positive duration) and is excluded from the load
 * total -- the same conservative posture buildLoadSeries takes. */
function loadOf(w: AggregateCompletedWorkout): { tss: number; confidence: LoadConfidence } | null {
  const result = computeWorkoutTss({
    started_at: w.started_at,
    duration_s: w.duration_s,
    summary_stats: w.summary_stats,
  });
  return result ? { tss: result.tss, confidence: result.confidence } : null;
}

function summarizeConfidence(confidences: LoadConfidence[]): PeriodTotals["loadConfidence"] {
  if (confidences.length === 0) return "none";
  const hasPower = confidences.includes("power");
  const hasDuration = confidences.includes("duration");
  if (hasPower && hasDuration) return "mixed";
  return hasPower ? "power" : "duration";
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

function computeTotals(
  completed: AggregateCompletedWorkout[],
  timezone: string,
): PeriodTotals {
  const activeDays = new Set<string>();
  const confidences: LoadConfidence[] = [];
  let durationS = 0;
  let load = 0;

  for (const w of completed) {
    durationS += durationOf(w);
    const l = loadOf(w);
    if (l) {
      load += l.tss;
      confidences.push(l.confidence);
    }
    activeDays.add(localDayInTimezone(timezone, new Date(w.started_at)));
  }

  return {
    sessions: completed.length,
    durationS: round2(durationS),
    distanceM: sumOrNull(completed.map((w) => w.distance_m)),
    load: round2(load),
    activeDays: activeDays.size,
    loadConfidence: summarizeConfidence(confidences),
  };
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

function computeCompliance(
  completed: AggregateCompletedWorkout[],
  planned: AggregatePlannedWorkout[],
): PeriodCompliance {
  const prescribedIds = new Set(planned.map((p) => p.id));

  // A SET, not a count: two efforts matched to the same prescription are one
  // prescribed session executed, not two. Counting matches instead of matched
  // prescriptions would let an athlete who logged a session twice read as
  // having done more of their plan than they did.
  const satisfied = new Set<string>();
  let unplanned = 0;

  for (const w of completed) {
    const matched = w.matched_planned_workout_id;
    // A match pointing at a prescription OUTSIDE this period does not count
    // toward this period's compliance -- the effort is attributed to the
    // period it happened in, and its prescription to the period it was
    // scheduled in.
    if (matched != null && prescribedIds.has(matched)) {
      satisfied.add(matched);
    } else {
      unplanned += 1;
    }
  }

  return { prescribed: planned.length, completed: satisfied.size, unplanned };
}

// ---------------------------------------------------------------------------
// Sport rollup
// ---------------------------------------------------------------------------

function computeSports(completed: AggregateCompletedWorkout[]): PeriodSportRollup[] {
  const bySport = new Map<Sport, AggregateCompletedWorkout[]>();
  for (const w of completed) {
    const sport = toSport(w.sport);
    const bucket = bySport.get(sport);
    if (bucket) bucket.push(w);
    else bySport.set(sport, [w]);
  }

  const rows: PeriodSportRollup[] = [];
  for (const [sport, workouts] of bySport) {
    let durationS = 0;
    let load = 0;
    for (const w of workouts) {
      durationS += durationOf(w);
      load += loadOf(w)?.tss ?? 0;
    }
    rows.push({
      sport,
      sessions: workouts.length,
      durationS: round2(durationS),
      distanceM: sumOrNull(workouts.map((w) => w.distance_m)),
      load: round2(load),
    });
  }

  // Heaviest first, then alphabetically -- a total order, so the output is
  // byte-stable regardless of the order rows arrived from Postgres.
  return rows.sort((a, b) => b.load - a.load || a.sport.localeCompare(b.sport));
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function computeComparison(
  current: PeriodTotals,
  previous: AggregateInput["previous"],
  timezone: string,
): PeriodComparison {
  if (previous == null) return { available: false };

  const prior = computeTotals(previous.completed, timezone);

  // A percentage against a zero prior is undefined (see percentChange). It is
  // reported as 0 here rather than degrading the whole comparison, because the
  // ABSENT/AVAILABLE distinction already carries the "nothing to compare"
  // meaning, and an athlete returning from a total break still wants the rest
  // of the block. The narration reads `loadDeltaPct` alongside the raw totals,
  // so it can describe the return without leaning on the percentage.
  return {
    available: true,
    previousKey: previous.key,
    sessionsDeltaPct: percentChange(prior.sessions, current.sessions) ?? 0,
    durationDeltaPct: percentChange(prior.durationS, current.durationS) ?? 0,
    loadDeltaPct: percentChange(prior.load, current.load) ?? 0,
    activeDaysDelta: current.activeDays - prior.activeDays,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Roll one period's completed and prescribed work up into the deterministic
 * fact set the review renders and the narration explains.
 */
export function aggregatePeriod(input: AggregateInput): PeriodFacts {
  const totals = computeTotals(input.completed, input.timezone);

  // Prescribed sides are summed over the rows that actually carry a value, and
  // are null when NONE do -- which is what degrades the metric rather than
  // scoring the athlete against a phantom zero.
  const prescribedDuration = sumOrNull(
    input.planned.map((p) => readStructureDurationSeconds(p.structure)),
  );
  const prescribedLoad = sumOrNull(
    input.planned.map((p) => readStructureLoad(p.structure, p.planned_load)),
  );

  return {
    kind: input.kind,
    periodKey: input.periodKey,
    bounds: input.bounds,
    totals,
    compliance: computeCompliance(input.completed, input.planned),
    duration: toMetric(prescribedDuration, totals.durationS),
    load: toMetric(prescribedLoad, totals.load),
    sports: computeSports(input.completed),
    comparison: computeComparison(totals, input.previous, input.timezone),
  };
}
