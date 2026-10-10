import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { calendarDayInTimezone } from "@/lib/format";
import {
  addDays,
  buildLoadSeries,
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
const FORM_CHART_LONG_DAYS = 90;

export interface TrainingOverview {
  ctl: number;
  atl: number;
  tsb: number;
  series: LoadDayPoint[];
  /** 90-day form series for the mobile 90d toggle. */
  seriesLong: LoadDayPoint[];
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
  const [workoutsRes, profileRes, planRes] = await Promise.all([
    admin
      .from("completed_workouts")
      .select("started_at, sport, duration_s, summary_stats")
      .eq("athlete_id", athleteId)
      .is("deleted_at", null)
      .is("superseded_by_id", null)
      .gte("started_at", since)
      .order("started_at", { ascending: true }),
    admin.from("athlete_profiles").select("manual_fields").eq("user_id", athleteId).maybeSingle(),
    admin
      .from("plans")
      .select("event_type, event_date")
      .eq("athlete_id", athleteId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (workoutsRes.error) throw new Error(`overview workouts failed: ${workoutsRes.error.message}`);

  const rows = (workoutsRes.data ?? []) as WorkoutRow[];
  const loadInputs: LoadWorkoutInput[] = rows.map((w) => ({
    started_at: w.started_at,
    duration_s: w.duration_s,
    summary_stats: w.summary_stats ?? {},
  }));
  const load = buildLoadSeries(loadInputs, { asOf: today });
  const workouts: OverviewWorkout[] = rows.map((w) => ({
    day: calendarDayInTimezone(w.started_at, timezone),
    sport: w.sport,
    durationS: w.duration_s ?? 0,
  }));

  const chartFrom = addDays(today, -(FORM_CHART_DAYS - 1));
  const chartFromLong = addDays(today, -(FORM_CHART_LONG_DAYS - 1));
  const manual = (profileRes.data?.manual_fields ?? {}) as {
    target_event?: { type?: string; date?: string; name?: string };
  };
  const profileEvent = manual.target_event;
  const plan = planRes.data as { event_type: string | null; event_date: string | null } | null;
  // The active plan owns the goal event; the profile race is only a fallback.
  const eventDate = plan?.event_date ?? profileEvent?.date ?? null;
  const eventLabel =
    profileEvent?.name || plan?.event_type || profileEvent?.type || "Race day";
  const days = eventDate ? daysUntil(eventDate, today) : null;

  return {
    ctl: load.ctl,
    atl: load.atl,
    tsb: load.tsb,
    series: load.series.filter((p) => p.date >= chartFrom),
    seriesLong: load.series.filter((p) => p.date >= chartFromLong),
    weekly: weeklyBuckets(workouts, today),
    sports: bySport(workouts, today),
    last28: last28(workouts, today),
    race:
      eventDate && days !== null
        ? { label: eventLabel, date: eventDate.slice(0, 10), days }
        : null,
    hasData: workouts.length > 0,
  };
}
