import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EditedByKind } from "@da2/shared";

export interface WorkoutRow {
  id: string;
  started_at: string;
  sport: string;
  duration_s: number | null;
  distance_m: number | null;
  source: string;
  summary_stats: Record<string, unknown>;
}

export interface WorkoutDetailRow {
  id: string;
  started_at: string;
  sport: string;
  duration_s: number | null;
  distance_m: number | null;
  source: string;
  strava_activity_id: number | null;
  summary_stats: Record<string, unknown>;
}

export type PlannedStatus = "planned" | "completed" | "skipped" | "moved";

export interface PlannedRow {
  id: string;
  scheduled_date: string;
  sport: string;
  status: PlannedStatus;
  structure: Record<string, unknown>;
  // Who last edited this row (Unit 2 attribution). `ai_review` rows get a
  // distinct calendar badge vs. coach/athlete edits (Unit 11). NULL = never
  // edited since assignment.
  edited_by_kind: EditedByKind | null;
}

export interface WeekStats {
  count: number;
  totalDurationS: number;
  totalDistanceM: number;
  sports: Record<string, number>;
}

/**
 * Returns a single workout by ID for the given athlete.
 * Returns null if not found or soft-deleted / superseded.
 * Throws on Supabase error.
 */
export async function getWorkoutById(
  supabase: SupabaseClient,
  athleteId: string,
  workoutId: string
): Promise<WorkoutDetailRow | null> {
  const { data, error } = await supabase
    .from("completed_workouts")
    .select(
      "id, started_at, sport, duration_s, distance_m, source, strava_activity_id, summary_stats"
    )
    .eq("id", workoutId)
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .is("superseded_by_id", null)
    .maybeSingle();

  if (error) {
    throw new Error(`getWorkoutById failed: ${error.message}`);
  }
  return data as WorkoutDetailRow | null;
}

/**
 * Returns the last N completed workouts for the user, most recent first.
 * Excludes soft-deleted rows.
 */
export async function getRecentWorkouts(
  supabase: SupabaseClient,
  athleteId: string,
  limit = 20,
  sport?: string
): Promise<WorkoutRow[]> {
  let query = supabase
    .from("completed_workouts")
    .select("id, started_at, sport, duration_s, distance_m, source, summary_stats")
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .is("superseded_by_id", null);

  if (sport) query = query.eq("sport", sport);

  const { data, error } = await query
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`getRecentWorkouts failed: ${error.message}`);
  }
  return (data ?? []) as WorkoutRow[];
}

/**
 * Returns completed workouts between two ISO date strings (inclusive),
 * for the user. Excludes soft-deleted rows.
 */
export async function getWorkoutsInRange(
  supabase: SupabaseClient,
  athleteId: string,
  from: string,
  to: string
): Promise<WorkoutRow[]> {
  const { data, error } = await supabase
    .from("completed_workouts")
    .select("id, started_at, sport, duration_s, distance_m, source, summary_stats")
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .is("superseded_by_id", null)
    .gte("started_at", from)
    .lte("started_at", to)
    .order("started_at", { ascending: true });

  if (error) {
    throw new Error(`getWorkoutsInRange failed: ${error.message}`);
  }
  return (data ?? []) as WorkoutRow[];
}

/**
 * Returns planned workouts between two dates (scheduled_date), for the user.
 * Excludes soft-deleted rows.
 */
export async function getPlannedInRange(
  supabase: SupabaseClient,
  athleteId: string,
  from: string,
  to: string
): Promise<PlannedRow[]> {
  const { data, error } = await supabase
    .from("planned_workouts")
    .select("id, scheduled_date, sport, status, structure, edited_by_kind")
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .gte("scheduled_date", from)
    .lte("scheduled_date", to)
    .order("scheduled_date", { ascending: true });

  if (error) {
    throw new Error(`getPlannedInRange failed: ${error.message}`);
  }
  return (data ?? []) as PlannedRow[];
}

/**
 * `PlannedRow` plus the fields the planned-workout detail page needs
 * (rationale text, prescribed load) but `getPlannedInRange` callers don't --
 * see the unit's task notes for why this is a separate type rather than a
 * widened `PlannedRow` (calendar page, athlete dashboard, and several AI
 * context builders all consume `PlannedRow` via `getPlannedInRange` and would
 * otherwise gain always-undefined fields).
 */
export interface PlannedDetailRow extends PlannedRow {
  rationale: string | null;
  planned_load: number | null;
}

/**
 * Returns a single planned workout by ID for the given athlete.
 * Returns null if not found or soft-deleted.
 */
export async function getPlannedById(
  supabase: SupabaseClient,
  athleteId: string,
  id: string
): Promise<PlannedDetailRow | null> {
  const { data, error } = await supabase
    .from("planned_workouts")
    .select("id, scheduled_date, sport, status, structure, edited_by_kind, rationale, planned_load")
    .eq("id", id)
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`getPlannedById failed: ${error.message}`);
  }
  return data as PlannedDetailRow | null;
}

export interface PlannedMatch {
  planned_workout_id: string;
  completed_workout: WorkoutRow;
}

/**
 * Returns the live (non-superseded) workout_matches rows for the given
 * planned workout IDs, joined with the matched completed workout's summary
 * fields. Used so the calendar can render a matched planned+completed pair
 * as a single card instead of two unlinked chips.
 */
export async function getMatchesForPlannedIds(
  supabase: SupabaseClient,
  plannedIds: string[]
): Promise<PlannedMatch[]> {
  if (plannedIds.length === 0) return [];

  const { data, error } = await supabase
    .from("workout_matches")
    .select(
      "planned_workout_id, completed_workouts(id, started_at, sport, duration_s, distance_m, source, summary_stats)"
    )
    .in("planned_workout_id", plannedIds)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`getMatchesForPlannedIds failed: ${error.message}`);
  }

  return (data ?? [])
    .filter((row) => row.completed_workouts != null)
    .map((row) => ({
      planned_workout_id: row.planned_workout_id as string,
      completed_workout: row.completed_workouts as unknown as WorkoutRow,
    }));
}

/**
 * Returns stats for the current calendar week (Mon–today) in UTC.
 */
export async function getThisWeekStats(
  supabase: SupabaseClient,
  athleteId: string
): Promise<WeekStats> {
  const now = new Date();
  // Find Monday of current week in UTC (ISO week starts Mon).
  const dayOfWeek = now.getUTCDay(); // 0=Sun,1=Mon,...,6=Sat
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - daysFromMonday);
  monday.setUTCHours(0, 0, 0, 0);

  const todayEnd = new Date(now);
  todayEnd.setUTCHours(23, 59, 59, 999);

  const workouts = await getWorkoutsInRange(
    supabase,
    athleteId,
    monday.toISOString(),
    todayEnd.toISOString()
  );

  const stats: WeekStats = {
    count: workouts.length,
    totalDurationS: 0,
    totalDistanceM: 0,
    sports: {},
  };

  for (const w of workouts) {
    stats.totalDurationS += w.duration_s ?? 0;
    stats.totalDistanceM += w.distance_m ?? 0;
    stats.sports[w.sport] = (stats.sports[w.sport] ?? 0) + 1;
  }

  return stats;
}
