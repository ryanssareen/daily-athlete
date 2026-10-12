import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { calendarDayInTimezone } from "@/lib/format";
import {
  addDays,
  buildLoadSeries,
  localizeLoadInputs,
  type LoadDayPoint,
  type LoadWorkoutInput,
} from "@/training-load/load-series";

import {
  bySport,
  daysUntil,
  last28,
  weeklyBuckets,
  type Last28,
  type OverviewWorkout,
  type SportRow,
  type WeeklyBucket,
} from "./calc";

const LOOKBACK_DAYS = 120;
const FORM_CHART_DAYS = 28;

export interface TrainingOverview {
  ctl: number;
  atl: number;
  tsb: number;
  series: LoadDayPoint[];
  weekly: WeeklyBucket[];
  sports: SportRow[];
  last28: Last28;
  race: { label: string; date: string; days: number } | null;
  hasData: boolean;
}

interface WorkoutRow {
  started_at: string;
  sport: string;
  duration_s: number | null;
  summary_stats: Record<string, unknown> | null;
}

export async function getTrainingOverview(
  admin: SupabaseClient,
  athleteId: string,
  timezone: string,
  now: Date,
): Promise<TrainingOverview> {
  const today = calendarDayInTimezone(now.toISOString(), timezone);
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();

  // service-role: explicit user filter required
  const [workoutsRes, profileRes] = await Promise.all([
    admin
      .from("completed_workouts")
      .select("started_at, sport, duration_s, summary_stats")
      .eq("athlete_id", athleteId)
      .is("deleted_at", null)
      .is("superseded_by_id", null)
      .gte("started_at", since)
      .order("started_at", { ascending: true }),
    admin.from("athlete_profiles").select("manual_fields").eq("user_id", athleteId).maybeSingle(),
  ]);
  if (workoutsRes.error) throw new Error(`overview workouts failed: ${workoutsRes.error.message}`);

  const rows = (workoutsRes.data ?? []) as WorkoutRow[];
  const loadInputs: LoadWorkoutInput[] = localizeLoadInputs(
    rows.map((w) => ({
      started_at: w.started_at,
      duration_s: w.duration_s,
      summary_stats: w.summary_stats ?? {},
    })),
    timezone,
  );
  const load = buildLoadSeries(loadInputs, { asOf: today });
  const workouts: OverviewWorkout[] = rows.map((w) => ({
    day: calendarDayInTimezone(w.started_at, timezone),
    sport: w.sport,
    durationS: w.duration_s ?? 0,
  }));

  const chartFrom = addDays(today, -(FORM_CHART_DAYS - 1));
  const manual = (profileRes.data?.manual_fields ?? {}) as {
    target_event?: { type?: string; date?: string; name?: string };
  };
  const event = manual.target_event;
  const days = event?.date ? daysUntil(event.date, today) : null;

  return {
    ctl: load.ctl,
    atl: load.atl,
    tsb: load.tsb,
    series: load.series.filter((p) => p.date >= chartFrom),
    weekly: weeklyBuckets(workouts, today),
    sports: bySport(workouts, today),
    last28: last28(workouts, today),
    race:
      event?.date && days !== null
        ? { label: event.name || event.type || "Race day", date: event.date.slice(0, 10), days }
        : null,
    hasData: workouts.length > 0,
  };
}
