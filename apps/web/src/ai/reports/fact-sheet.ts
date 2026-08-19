// Compact, already-computed fact sheet for the narration LLM call (Unit U5,
// docs/plans/2026-08-18-001-feat-workout-reports-plan.md).
//
// `buildFactSheet(context, delta)` projects the already-computed
// `ExecutionDelta` (Unit U3, pure/deterministic per KTD1) and a few fields of
// `ReportContext` (Unit U4) into the SMALLEST shape the narration model
// needs. This is the whole point of KTD1: the model is handed conclusions
// and resolved numbers, never a raw payload, so it cannot invent a number it
// was not given and the hallucination surface collapses to "wrote prose over
// a fact it was handed" rather than "computed its own answer".
//
// KTD8: a dimension with status "unavailable" is OMITTED from the fact sheet
// entirely -- not rendered as an explicit "n/a"/null marker. There is
// nothing there for the model to explain, and an explicit "unavailable"
// field would only invite the model to comment on missing data instead of
// the workout itself.
//
// NO RAW DATA: no lap arrays, no full `summary_stats` blob, no Strava
// payload, no `recentLoad.series` (the full daily CTL/ATL/TSB history) --
// only the three most-recent scalar values. See __tests__/narrate.test.ts
// for the size/shape assertion this constraint is pinned by.

import type { ExecutionDelta, ExecutionDeltaDimensions, IntensityTarget, Verdict } from "@da2/shared";

import type { ReportContext } from "./context";

export interface FactSheetDimension {
  status: "on_target" | "under" | "over";
  prescribed: number;
  actual: number;
  deltaPct: number;
}

export interface FactSheetIntensityDimension extends FactSheetDimension {
  /** The target the actual was resolved and compared against (%FTP / zone /
   * pace) -- see `IntensityDimensionDeltaSchema` in
   * packages/shared/src/workout-report.ts. Carried so the model (and the
   * fact-sheet reader) knows WHAT was being compared, not just a bare number. */
  target: IntensityTarget;
}

/** Present dimensions only -- an "unavailable" dimension has no key here at all. */
export interface FactSheetComparison {
  duration?: FactSheetDimension;
  load?: FactSheetDimension;
  intensity?: FactSheetIntensityDimension;
}

export interface FactSheet {
  /** Fixed, already-decided (KTD1). The model explains this; it never re-judges it. */
  verdict: Verdict;
  sport: string;
  /** null when the workout is unmatched (R4/AE3) -- no prescription exists to
   * compare against, so there is no comparison block at all. */
  comparison: FactSheetComparison | null;
  /** CTL/ATL/TSB as of the workout's day. NEVER the full daily series. */
  recentLoad: { ctl: number; atl: number; tsb: number };
  /** Athlete-authored free text (`plans.event_type`) -- UNTRUSTED. Delimited
   * as data by narrate.ts's prompt builder, never placed in the
   * system/instruction region, and truncated to GOAL_MAX_LENGTH here. */
  goal: string | null;
  eventDate: string | null;
}

/**
 * Hard cap on the one athlete-authored free-text field that reaches the
 * narration prompt. `plans.event_type` has no length constraint in the
 * schema or at any write path, so without this an athlete (or anything
 * writing through the MCP surface) could push an arbitrarily large string
 * into every narration call -- inflating cost, crowding the real facts out
 * of the model's attention, and giving a prompt-injection attempt room to
 * work inside the data tag. 120 characters is generous for a genuine event
 * description ("Ironman 70.3 Staffordshire", "sub-3 marathon").
 */
export const GOAL_MAX_LENGTH = 120;

function capGoal(goal: string | null | undefined): string | null {
  if (goal == null) return null;
  const trimmed = goal.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= GOAL_MAX_LENGTH ? trimmed : `${trimmed.slice(0, GOAL_MAX_LENGTH)}…`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildComparison(dims: ExecutionDeltaDimensions): FactSheetComparison {
  const out: FactSheetComparison = {};

  if (dims.duration.status !== "unavailable") {
    out.duration = {
      status: dims.duration.status,
      prescribed: dims.duration.prescribed,
      actual: dims.duration.actual,
      deltaPct: dims.duration.deltaPct,
    };
  }
  if (dims.load.status !== "unavailable") {
    out.load = {
      status: dims.load.status,
      prescribed: dims.load.prescribed,
      actual: dims.load.actual,
      deltaPct: dims.load.deltaPct,
    };
  }
  if (dims.intensity.status !== "unavailable") {
    out.intensity = {
      status: dims.intensity.status,
      prescribed: dims.intensity.prescribed,
      actual: dims.intensity.actual,
      deltaPct: dims.intensity.deltaPct,
      target: dims.intensity.target,
    };
  }

  return out;
}

/**
 * Render the compact fact sheet the narration model is handed. Pure --
 * reads only `context`/`delta`, no I/O.
 */
export function buildFactSheet(context: ReportContext, delta: ExecutionDelta): FactSheet {
  return {
    verdict: delta.verdict,
    sport: context.completedWorkout.sport,
    comparison: delta.matched ? buildComparison(delta.dimensions) : null,
    recentLoad: {
      ctl: round1(context.recentLoad.ctl),
      atl: round1(context.recentLoad.atl),
      tsb: round1(context.recentLoad.tsb),
    },
    goal: capGoal(context.plan?.goal),
    eventDate: context.plan?.event_date ?? null,
  };
}
