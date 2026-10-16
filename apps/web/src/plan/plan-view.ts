import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PlanViewSchema,
  type PlanRow,
  type PlanView,
  type PlanViewForecast,
  type PlanViewSectionError,
  type PlanViewWeek,
} from "@da2/shared";

import type { LoadWorkoutInput } from "@/training-load/load-series";

import { forecastPlan } from "./plan-forecast";
import { computeWeekResults, emptyWeek } from "./plan-results";
import { composePlanStory, composeWeekFocus, detectPhases, groupByWeek } from "./plan-story";
import { mondayOf, todayIn } from "./plan-summary";
import type { CountedSession, MatchedCompleted } from "./plan-view-types";

const HISTORY_LOOKBACK_DAYS = 120;
const ID_CHUNK_SIZE = 100;

export class PlanViewNotFoundError extends Error {
  constructor() {
    super("plan not found for athlete");
    this.name = "PlanViewNotFoundError";
  }
}

interface PlannedRow {
  id: string;
  scheduled_date: string;
  sport: string;
  status: string;
  structure: Record<string, unknown> | null;
  rationale: string | null;
  planned_load: number | null;
}

interface MatchRow {
  id: string;
  planned_workout_id: string;
  completed_workout_id: string;
  confidence: number;
  matched_at: string;
}

interface CompletedRow {
  id: string;
  duration_s: number | null;
  distance_m: number | null;
  sport: string;
  summary_stats: Record<string, unknown> | null;
}

interface HistoryRow {
  started_at: string;
  duration_s: number | null;
  summary_stats: Record<string, unknown> | null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isCounted(status: string): status is CountedSession["status"] {
  return status === "planned" || status === "moved" || status === "completed";
}

function toCounted(row: PlannedRow): CountedSession | null {
  if (!isCounted(row.status)) return null;
  return {
    id: row.id,
    date: row.scheduled_date,
    sport: row.sport,
    status: row.status,
    structure: row.structure,
    plannedLoadColumn: row.planned_load,
    rationale: row.rationale,
  };
}

function bestMatch(rows: MatchRow[]): MatchRow {
  return rows.reduce((best, row) => {
    if (row.confidence !== best.confidence) return row.confidence > best.confidence ? row : best;
    if (row.matched_at !== best.matched_at) return row.matched_at > best.matched_at ? row : best;
    return row.id > best.id ? row : best;
  });
}

async function loadMatchedCompleted(
  admin: SupabaseClient,
  athleteId: string,
  plannedIds: string[],
): Promise<Map<string, MatchedCompleted>> {
  const matchesByPlanned = new Map<string, MatchRow[]>();
  for (const ids of chunk(plannedIds, ID_CHUNK_SIZE)) {
    // service-role: explicit user filter required (ids already scoped to the athlete's plan rows)
    const { data, error } = await admin
      .from("workout_matches")
      .select("id, planned_workout_id, completed_workout_id, confidence, matched_at")
      .in("planned_workout_id", ids)
      .is("deleted_at", null);
    if (error) throw new Error(`plan view matches failed: ${error.message}`);
    for (const row of (data ?? []) as MatchRow[]) {
      const list = matchesByPlanned.get(row.planned_workout_id) ?? [];
      list.push(row);
      matchesByPlanned.set(row.planned_workout_id, list);
    }
  }

  const chosen = new Map<string, MatchRow>();
  for (const [plannedId, rows] of matchesByPlanned) chosen.set(plannedId, bestMatch(rows));

  const completedIds = [...new Set([...chosen.values()].map((m) => m.completed_workout_id))];
  const completedById = new Map<string, CompletedRow>();
  for (const ids of chunk(completedIds, ID_CHUNK_SIZE)) {
    // service-role: explicit user filter required
    const { data, error } = await admin
      .from("completed_workouts")
      .select("id, duration_s, distance_m, sport, summary_stats")
      .eq("athlete_id", athleteId)
      .is("deleted_at", null)
      .in("id", ids);
    if (error) throw new Error(`plan view completed workouts failed: ${error.message}`);
    for (const row of (data ?? []) as CompletedRow[]) completedById.set(row.id, row);
  }

  const result = new Map<string, MatchedCompleted>();
  for (const [plannedId, match] of chosen) {
    const completed = completedById.get(match.completed_workout_id);
    if (!completed) continue;
    result.set(plannedId, {
      duration_s: completed.duration_s,
      distance_m: completed.distance_m,
      sport: completed.sport,
      summary_stats: completed.summary_stats ?? {},
    });
  }
  return result;
}

async function loadHistory(
  admin: SupabaseClient,
  athleteId: string,
  now: Date,
): Promise<LoadWorkoutInput[]> {
  const since = new Date(now.getTime() - HISTORY_LOOKBACK_DAYS * 86_400_000).toISOString();
  // service-role: explicit user filter required
  const { data, error } = await admin
    .from("completed_workouts")
    .select("started_at, duration_s, summary_stats")
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .is("superseded_by_id", null)
    .gte("started_at", since)
    .order("started_at", { ascending: true });
  if (error) throw new Error(`plan view history failed: ${error.message}`);
  return ((data ?? []) as HistoryRow[]).map((w) => ({
    started_at: w.started_at,
    duration_s: w.duration_s,
    summary_stats: w.summary_stats ?? {},
  }));
}

export async function buildPlanView(
  admin: SupabaseClient,
  athleteId: string,
  plan: PlanRow,
  timezone: string,
  now: Date,
): Promise<PlanView> {
  if (plan.athlete_id !== athleteId) throw new PlanViewNotFoundError();

  const today = todayIn(timezone, now);

  // service-role: explicit user filter required
  const { data: plannedData, error: plannedError } = await admin
    .from("planned_workouts")
    .select("id, scheduled_date, sport, status, structure, rationale, planned_load")
    .eq("plan_id", plan.id)
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .order("scheduled_date", { ascending: true });
  if (plannedError) throw new Error(`plan view workouts failed: ${plannedError.message}`);

  const rows = (plannedData ?? []) as PlannedRow[];
  const sessions = rows.flatMap((row) => {
    const counted = toCounted(row);
    return counted ? [counted] : [];
  });
  const skippedDates = rows.filter((r) => r.status === "skipped").map((r) => r.scheduled_date);

  const sectionErrors: PlanViewSectionError[] = [];

  let matches = new Map<string, MatchedCompleted>();
  const completedIds = sessions.filter((s) => s.status === "completed").map((s) => s.id);
  if (completedIds.length > 0) {
    try {
      matches = await loadMatchedCompleted(admin, athleteId, completedIds);
    } catch {
      sectionErrors.push("verdicts");
    }
  }

  const eventDate = plan.event_date ? plan.event_date.slice(0, 10) : null;

  let forecast: PlanViewForecast = { status: "unavailable-no-data" };
  try {
    const remaining = sessions.filter((s) => s.status !== "completed" && s.date >= today);
    const history = remaining.length > 0 ? await loadHistory(admin, athleteId, now) : [];
    forecast = forecastPlan({ history, remaining, today, eventDate });
  } catch {
    sectionErrors.push("forecast");
  }

  const phases = detectPhases({ sessions, eventDate });
  const story = composePlanStory({
    sessions,
    eventType: plan.event_type,
    eventDate,
    today,
    phases,
  });
  const results = computeWeekResults({ sessions, skippedDates, matches, today });

  const sessionsByWeek = groupByWeek(sessions);
  const weekStarts = [...new Set([...sessionsByWeek.keys(), ...results.keys()])].sort();
  const thisMonday = mondayOf(today);

  const weeks: PlanViewWeek[] = weekStarts.map((start) => {
    const weekResults = results.get(start) ?? emptyWeek();
    return {
      start,
      phase: phases.get(start) ?? null,
      focus: composeWeekFocus(sessionsByWeek.get(start) ?? []),
      plannedSeconds: weekResults.plannedSeconds,
      executedSeconds: weekResults.executedSeconds,
      dueSeconds: weekResults.dueSeconds,
      compliance: weekResults.compliance,
      skippedCount: weekResults.skippedCount,
      current: start === thisMonday,
      sessions: weekResults.sessions,
    };
  });

  return PlanViewSchema.parse({
    planId: plan.id,
    story,
    weeks,
    forecast,
    sectionErrors,
  });
}
