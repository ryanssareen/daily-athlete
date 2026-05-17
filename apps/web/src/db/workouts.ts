import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export interface WorkoutRow {
  id: string;
  started_at: string;
  sport: string;
  duration_s: number | null;
  distance_m: number | null;
  source: string;
}

export interface PlannedRow {
  id: string;
  scheduled_date: string;
  sport: string;
  status: string;
  structure: Record<string, unknown>;
}

export interface WeekStats {
  count: number;
  totalDurationS: number;
  totalDistanceM: number;
  sports: Record<string, number>;
}

/**
 * Returns the last N completed workouts for the user, most recent first.
 * Excludes soft-deleted rows.
 */
export async function getRecentWorkouts(
  supabase: SupabaseClient,
  athleteId: string,
  limit = 20
): Promise<WorkoutRow[]> {
  const { data, error } = await supabase
    .from("completed_workouts")
    .select("id, started_at, sport, duration_s, distance_m, source")
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
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
    .select("id, started_at, sport, duration_s, distance_m, source")
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
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
    .select("id, scheduled_date, sport, status, structure")
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
