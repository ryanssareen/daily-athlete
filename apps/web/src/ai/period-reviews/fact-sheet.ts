import "server-only";

// Project a computed `PeriodFacts` into the narration prompt's input (U5).
//
// KTD9 -- THE CONSTRAINT THIS MODULE EXISTS TO ENFORCE. Groq bills
// `max_completion_tokens` against the per-minute allowance BEFORE generating,
// so an oversized request is rejected outright and the prose never generates at
// all (see NARRATION_MAX_TOKENS in apps/web/src/ai/reports/narrate.ts for the
// incident that taught us this). A month of training is 15-30 workouts; handing
// the model that list would blow the budget AND miss the point -- the model is
// meant to explain the aggregate, not re-derive it.
//
// So the fact sheet is BOUNDED BY CONSTRUCTION and roughly constant in size
// whether the period is a week or a month:
//   - totals, compliance, and the two prescribed-vs-actual comparisons: fixed
//   - per-sport rows: at most one per sport, and the sport vocabulary is closed
//   - standout sessions: capped at STANDOUT_LIMIT, hard
// Nothing here grows with the number of workouts in the period.
//
// The other job of this module is the same one the per-workout fact sheet has:
// resolve every value into a statement with its unit already applied, so the
// model receives conclusions rather than raw rows it might reinterpret.

import type { PeriodComparison, PeriodFacts, PeriodMetric } from "@da2/shared";

import type { AggregateCompletedWorkout } from "./aggregate";

/** A resolvable comparison, flattened. An "unavailable" metric has no entry --
 * absence is how the prompt says "unknown", never a zero. */
export interface FactSheetMetric {
  status: "on_target" | "under" | "over";
  prescribed: number;
  actual: number;
  deltaPct: number;
}

export interface FactSheetSport {
  sport: string;
  sessions: number;
  durationS: number;
  distanceM: number | null;
  load: number;
}

export interface FactSheetStandout {
  sport: string;
  day: string;
  durationS: number;
  load: number;
}

export interface PeriodFactSheet {
  kind: "weekly" | "monthly";
  periodKey: string;
  bounds: { start: string; end: string };
  totals: PeriodFacts["totals"];
  compliance: PeriodFacts["compliance"];
  /** Absent when the prescription could not be resolved (KTD8 degradation). */
  duration?: FactSheetMetric;
  load?: FactSheetMetric;
  sports: FactSheetSport[];
  /**
   * null when there is no prior period to compare against -- distinct from a
   * comparison whose numbers happen to be zero.
   *
   * Narrowed to the AVAILABLE branch rather than carrying the whole union: the
   * absent case is already expressed by `null` here, and keeping the
   * `{available: false}` member would force every reader to re-narrow a
   * distinction this field has already resolved.
   */
  comparison: Extract<PeriodComparison, { available: true }> | null;
  standouts: FactSheetStandout[];
  /** Athlete-authored free text (`plans.event_type`) -- UNTRUSTED. Delimited as
   * data by the prompt builder and truncated here. */
  goal: string | null;
  eventDate: string | null;
}

/**
 * How many individual sessions may be named in the prompt.
 *
 * Three, not "the interesting ones": the cap is what makes the prompt size
 * independent of period length (KTD9). Naming a couple of standout efforts
 * gives the narration something concrete to anchor on ("your Saturday ride
 * carried a third of the week's load") without reintroducing the workout list
 * through the back door.
 */
export const STANDOUT_LIMIT = 3;

/**
 * Hard cap on the one athlete-authored free-text field that reaches the prompt.
 * `plans.event_type` has no length constraint at any write path, so without
 * this an athlete -- or anything writing through the MCP surface -- could push
 * an arbitrarily large string into every narration call, inflating cost,
 * crowding the real facts out of the model's attention, and giving a
 * prompt-injection attempt room to work. Same cap and same reasoning as the
 * per-workout fact sheet.
 */
export const GOAL_MAX_LENGTH = 200;

function truncate(text: string | null, max: number): string | null {
  if (text == null) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`;
}

/** Flatten a metric, dropping the unavailable case. Absence in the prompt is
 * how "we don't know" is expressed -- a zero would be read as a real number. */
function toFactSheetMetric(metric: PeriodMetric): FactSheetMetric | undefined {
  if (metric.status === "unavailable") return undefined;
  return {
    status: metric.status,
    prescribed: metric.prescribed,
    actual: metric.actual,
    deltaPct: metric.deltaPct,
  };
}

/** The heaviest sessions in the period, by load, capped. Ties break on id so
 * the selection is deterministic for a fixed period. */
function pickStandouts(
  completed: AggregateCompletedWorkout[],
  localDay: (w: AggregateCompletedWorkout) => string,
  loadOf: (w: AggregateCompletedWorkout) => number,
): FactSheetStandout[] {
  return [...completed]
    .sort((a, b) => loadOf(b) - loadOf(a) || a.id.localeCompare(b.id))
    .slice(0, STANDOUT_LIMIT)
    .map((w) => ({
      sport: w.sport,
      day: localDay(w),
      durationS: typeof w.duration_s === "number" && w.duration_s > 0 ? w.duration_s : 0,
      load: Math.round(loadOf(w) * 100) / 100,
    }));
}

export interface BuildPeriodFactSheetArgs {
  facts: PeriodFacts;
  completed: AggregateCompletedWorkout[];
  /** Athlete-local day of a workout -- supplied by the caller so this module
   * stays free of timezone plumbing. */
  localDay: (w: AggregateCompletedWorkout) => string;
  /** Load of a single workout, from the shared training-load proxy. */
  loadOf: (w: AggregateCompletedWorkout) => number;
  goal: string | null;
  eventDate: string | null;
}

export function buildPeriodFactSheet(args: BuildPeriodFactSheetArgs): PeriodFactSheet {
  const { facts, completed, localDay, loadOf, goal, eventDate } = args;

  return {
    kind: facts.kind,
    periodKey: facts.periodKey,
    bounds: facts.bounds,
    totals: facts.totals,
    compliance: facts.compliance,
    duration: toFactSheetMetric(facts.duration),
    load: toFactSheetMetric(facts.load),
    sports: facts.sports.map((s) => ({
      sport: s.sport,
      sessions: s.sessions,
      durationS: s.durationS,
      distanceM: s.distanceM,
      load: s.load,
    })),
    comparison: facts.comparison.available ? facts.comparison : null,
    standouts: pickStandouts(completed, localDay, loadOf),
    goal: truncate(goal, GOAL_MAX_LENGTH),
    eventDate,
  };
}
