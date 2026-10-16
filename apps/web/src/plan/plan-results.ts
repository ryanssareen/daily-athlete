import {
  PLAN_VIEW_RATIONALE_MAX_LENGTH,
  type PlanViewSession,
  type Verdict,
} from "@da2/shared";

import { computeExecutionDelta } from "@/ai/reports/delta";
import {
  formatIntensityTarget,
  readStructureDurationSeconds,
  readStructureIntensityTarget,
  readStructureLoad,
} from "@/ai/planned-structure";

import { mondayOf } from "./plan-summary";
import type { CountedSession, MatchedCompleted } from "./plan-view-types";

export interface WeekResults {
  plannedSeconds: number;
  executedSeconds: number;
  dueSeconds: number;
  compliance: number | null;
  skippedCount: number;
  sessions: PlanViewSession[];
}

export function verdictForSession(
  session: CountedSession,
  matched: MatchedCompleted | undefined,
): Verdict | null {
  if (!matched) return null;
  return computeExecutionDelta({
    matched: true,
    completed: {
      duration_s: matched.duration_s,
      distance_m: matched.distance_m,
      sport: matched.sport,
      summary_stats: matched.summary_stats,
    },
    planned: {
      sport: session.sport,
      planned_load: session.plannedLoadColumn,
      structure: {
        duration_s: readStructureDurationSeconds(session.structure) ?? undefined,
        load: readStructureLoad(session.structure, session.plannedLoadColumn) ?? undefined,
        intensity_target: readStructureIntensityTarget(session.structure) ?? undefined,
      },
    },
  }).verdict;
}

function normalizeRationale(rationale: string | null): string | null {
  const trimmed = rationale?.trim().slice(0, PLAN_VIEW_RATIONALE_MAX_LENGTH).trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function toViewSession(session: CountedSession, matched: MatchedCompleted | undefined): PlanViewSession {
  return {
    id: session.id,
    date: session.date,
    sport: session.sport,
    plannedSeconds: readStructureDurationSeconds(session.structure),
    plannedLoad: readStructureLoad(session.structure, session.plannedLoadColumn),
    intensity: formatIntensityTarget(readStructureIntensityTarget(session.structure)),
    rationale: normalizeRationale(session.rationale),
    status: session.status,
    verdict: session.status === "completed" ? verdictForSession(session, matched) : null,
  };
}

function compareSessions(a: CountedSession, b: CountedSession): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export function emptyWeek(): WeekResults {
  return { plannedSeconds: 0, executedSeconds: 0, dueSeconds: 0, compliance: null, skippedCount: 0, sessions: [] };
}

export function computeWeekResults(input: {
  sessions: CountedSession[];
  skippedDates: string[];
  matches: Map<string, MatchedCompleted>;
  today: string;
}): Map<string, WeekResults> {
  const weeks = new Map<string, WeekResults>();
  const weekFor = (date: string): WeekResults => {
    const key = mondayOf(date);
    const existing = weeks.get(key);
    if (existing) return existing;
    const created = emptyWeek();
    weeks.set(key, created);
    return created;
  };

  for (const session of [...input.sessions].sort(compareSessions)) {
    const week = weekFor(session.date);
    const matched = input.matches.get(session.id);
    const plannedSeconds = readStructureDurationSeconds(session.structure) ?? 0;
    const completed = session.status === "completed";
    const due = completed || session.date <= input.today;

    week.plannedSeconds += plannedSeconds;
    if (due) week.dueSeconds += plannedSeconds;
    if (completed) week.executedSeconds += matched?.duration_s ?? plannedSeconds;
    week.sessions.push(toViewSession(session, matched));
  }

  for (const date of input.skippedDates) {
    weekFor(date).skippedCount += 1;
  }

  for (const week of weeks.values()) {
    week.compliance = week.dueSeconds > 0 ? week.executedSeconds / week.dueSeconds : null;
  }

  return weeks;
}
