import type { PlanViewForecast } from "@da2/shared";

import { readStructureDurationSeconds, readStructureLoad } from "@/ai/planned-structure";
import {
  buildLoadSeries,
  dayDiff,
  durationProxyTss,
  type LoadWorkoutInput,
} from "@/training-load/load-series";
import { formVerdict } from "@/training-overview/calc";

import type { CountedSession } from "./plan-view-types";

export const MISSING_LOAD_SHARE_LIMIT = 0.5;
export const EVENT_COVERAGE_DAYS = 2;

export interface ForecastInput {
  history: LoadWorkoutInput[];
  remaining: CountedSession[];
  today: string;
  eventDate: string | null;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function isUsable(load: number | null): load is number {
  return load !== null && Number.isFinite(load) && load >= 0;
}

function sessionLoad(session: CountedSession): number | null {
  const prescribed = readStructureLoad(session.structure, session.plannedLoadColumn);
  if (isUsable(prescribed)) return prescribed;
  const durationS = readStructureDurationSeconds(session.structure);
  if (durationS !== null && Number.isFinite(durationS) && durationS > 0) {
    return durationProxyTss(durationS);
  }
  return null;
}

export function forecastPlan(input: ForecastInput): PlanViewForecast {
  const remaining = input.remaining.filter((s) => s.status !== "completed");
  if (remaining.length === 0) return { status: "unavailable-complete" };

  const loads = remaining.map((session) => ({ session, load: sessionLoad(session) }));
  const missing = loads.filter((entry) => entry.load === null).length;
  if (missing / remaining.length > MISSING_LOAD_SHARE_LIMIT) {
    return { status: "unavailable-no-data" };
  }

  const synthetic: LoadWorkoutInput[] = loads.flatMap(({ session, load }) =>
    load === null
      ? []
      : [{ started_at: session.date, duration_s: null, summary_stats: { tss_equivalent: load } }],
  );

  const endDate = remaining.reduce(
    (latest, s) => (s.date > latest ? s.date : latest),
    remaining[0].date,
  );
  const workouts = [...input.history, ...synthetic];
  const block = buildLoadSeries(workouts, { asOf: endDate });
  const tsb = roundOne(block.tsb);

  const eventDate = input.eventDate;
  const covered =
    eventDate !== null &&
    eventDate >= endDate &&
    dayDiff(endDate, eventDate) <= EVENT_COVERAGE_DAYS;

  let eventDay: { date: string; tsb: number; formVerdict: string } | null = null;
  if (covered && eventDate !== null) {
    const projected = buildLoadSeries(workouts, { asOf: eventDate });
    const eventTsb = roundOne(projected.tsb);
    eventDay = { date: eventDate, tsb: eventTsb, formVerdict: formVerdict(eventTsb) };
  }

  return {
    status: "ok",
    endOfBlockDate: endDate,
    ctl: block.ctl,
    atl: block.atl,
    tsb,
    formVerdict: formVerdict(tsb),
    eventDay,
  };
}
