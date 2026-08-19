import "server-only";

// Gather everything one period review needs, in one pass (U4).
//
// SECURITY (AGENTS.md "RLS posture"): every read below filters explicitly on
// `athleteId`, so this module is correct under EITHER client --
//
//   - a user-JWT client (@supabase/ssr), where RLS is a second, independent
//     enforcement layer underneath the filters;
//   - a service-role client (@/db/admin), where the explicit filters ARE the
//     enforcement.
//
// That is not academic here. The route passes a service-role client (mobile
// Bearer callers otherwise query as `anon`, `auth.uid()` is NULL, and every
// RLS-scoped read returns zero rows -- see the same note in
// apps/web/src/ai/reports/context.ts), and the SCHEDULED DELIVERY WORKER has no
// user session at all. The per-query filter is the only thing standing between
// this module and a cross-athlete leak in the worker path.
//
// THE ONE INVARIANT THIS MODULE CANNOT CHECK: `athleteId` must be an
// AUTHENTICATED caller id (or, in the worker, an id the scheduler selected),
// never a client-supplied value. Nothing downstream re-derives it.
//
// DEGRADATION POLICY, and the way it differs from the per-workout report: a
// period with NO rows is a valid context, not a not-found. R5 is explicit that
// an empty week reports the absence rather than erroring, so there is no
// equivalent of CompletedWorkoutNotFoundError for "nothing happened". The only
// fatal input is a MALFORMED PERIOD KEY (InvalidPeriodKeyError, thrown by the
// calendar), which is a client error rather than a data condition. Every other
// read degrades to null/empty.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PeriodBounds, PeriodKind } from "@da2/shared";

import { pickBestMatch } from "@/ai/reports/context";

import type { AggregateCompletedWorkout, AggregatePlannedWorkout } from "./aggregate";
import { periodBounds, periodRangeUtc, previousPeriodKey } from "./calendar";

// --- Shapes -----------------------------------------------------------------

/** The active plan's event date + goal, best-effort. Sourced from
 * `plans.event_type` for `goal` -- `plans` has no column literally named
 * `goal`, and event_type is the athlete-authored free-text description already
 * treated as the goal-equivalent everywhere else in this repo. */
export interface PeriodPlanContext {
  id: string;
  event_date: string | null;
  goal: string | null;
}

export interface PeriodProfileContext {
  manual_fields: Record<string, unknown>;
  baselines: Record<string, unknown>;
}

export interface PeriodContext {
  athleteId: string;
  kind: PeriodKind;
  periodKey: string;
  bounds: PeriodBounds;
  timezone: string;
  completed: AggregateCompletedWorkout[];
  planned: AggregatePlannedWorkout[];
  /**
   * The preceding period, or null when the athlete has no training history
   * before this period at all.
   *
   * null and "present but empty" are DIFFERENT (see AggregateInput.previous):
   * null means there is nothing to compare against and the comparison is
   * absent; an empty `completed` means they had history and trained nothing,
   * which is a real -100%.
   */
  previous: { key: string; completed: AggregateCompletedWorkout[] } | null;
  plan: PeriodPlanContext | null;
  profile: PeriodProfileContext | null;
}

export interface GatherPeriodContextArgs {
  /** User-JWT or service-role client -- every read is athlete-filtered. */
  supabase: SupabaseClient;
  /** MUST be an authenticated / scheduler-selected id, never client-supplied. */
  athleteId: string;
  kind: PeriodKind;
  periodKey: string;
  /** The athlete's IANA timezone. Period boundaries are resolved in it. */
  timezone: string;
}

// --- Raw row shapes ---------------------------------------------------------

interface RawCompletedRow {
  id: string;
  sport: string;
  started_at: string;
  distance_m: number | null;
  duration_s: number | null;
  summary_stats: Record<string, unknown> | null;
}

interface RawPlannedRow {
  id: string;
  sport: string;
  scheduled_date: string;
  planned_load: number | null;
  structure: Record<string, unknown> | null;
}

interface RawMatchRow {
  id: string;
  completed_workout_id: string;
  planned_workout_id: string;
  confidence: number;
  method: string;
  matched_at: string;
}

interface RawPlanRow {
  id: string;
  event_date: string | null;
  event_type: string | null;
}

interface RawProfileRow {
  manual_fields: Record<string, unknown> | null;
  baselines: Record<string, unknown> | null;
}

// --- Reads ------------------------------------------------------------------

/**
 * Completed workouts inside a UTC instant range, athlete-scoped.
 *
 * Ordered by id so the row order is DETERMINISTIC. That is not cosmetic:
 * fingerprint.ts hashes an ordered projection of these rows, and Postgres
 * makes no ordering promise without an ORDER BY -- an unordered read would
 * produce a different hash for identical data and mark every review stale at
 * random.
 */
async function readCompleted(
  supabase: SupabaseClient,
  athleteId: string,
  startUtc: Date,
  endUtc: Date,
): Promise<RawCompletedRow[]> {
  // service-role: explicit user filter required
  const { data, error } = await supabase
    .from("completed_workouts")
    .select("id, sport, started_at, distance_m, duration_s, summary_stats")
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .gte("started_at", startUtc.toISOString())
    .lt("started_at", endUtc.toISOString())
    .order("id", { ascending: true });

  if (error) {
    throw new Error(`gatherPeriodContext: completed_workouts read failed: ${error.message}`);
  }
  return (data ?? []) as RawCompletedRow[];
}

/**
 * Resolve each completed workout to its best planned-workout match.
 *
 * `workout_matches` can hold several rows per completed workout (an automatic
 * match plus a manual re-link); `pickBestMatch` is reused from the per-workout
 * report rather than re-implementing the precedence, so both surfaces agree on
 * which prescription a session satisfied. Two reports disagreeing about that
 * would be worse than either being wrong.
 *
 * Degrades to an empty map on error -- every workout then reads as unplanned,
 * which understates compliance rather than inventing it.
 */
async function readMatches(
  supabase: SupabaseClient,
  completedIds: string[],
): Promise<Map<string, string>> {
  const byCompleted = new Map<string, string>();
  if (completedIds.length === 0) return byCompleted;

  // Keyed off ids already proven to belong to athleteId by readCompleted.
  const { data, error } = await supabase
    .from("workout_matches")
    .select("id, completed_workout_id, planned_workout_id, confidence, method, matched_at")
    .in("completed_workout_id", completedIds)
    .is("deleted_at", null);

  if (error || !data) return byCompleted;

  const grouped = new Map<string, RawMatchRow[]>();
  for (const row of data as RawMatchRow[]) {
    const bucket = grouped.get(row.completed_workout_id);
    if (bucket) bucket.push(row);
    else grouped.set(row.completed_workout_id, [row]);
  }

  for (const [completedId, rows] of grouped) {
    const best = pickBestMatch(
      rows as unknown as Parameters<typeof pickBestMatch>[0],
    );
    if (best) byCompleted.set(completedId, best.planned_workout_id);
  }
  return byCompleted;
}

function toAggregateCompleted(
  rows: RawCompletedRow[],
  matches: Map<string, string>,
): AggregateCompletedWorkout[] {
  return rows.map((r) => ({
    id: r.id,
    sport: r.sport,
    started_at: r.started_at,
    duration_s: r.duration_s,
    distance_m: r.distance_m,
    summary_stats: r.summary_stats ?? {},
    matched_planned_workout_id: matches.get(r.id) ?? null,
  }));
}

// --- Gather -----------------------------------------------------------------

/**
 * Gather one period's context, scoped to `athleteId` on every read.
 *
 * Throws only `InvalidPeriodKeyError` (from the calendar, for a malformed or
 * wrong-kind key). A period the athlete simply has no data for returns a
 * valid, empty context -- R5.
 */
export async function gatherPeriodContext(
  args: GatherPeriodContextArgs,
): Promise<PeriodContext> {
  const { supabase, athleteId, kind, periodKey, timezone } = args;

  // Throws InvalidPeriodKeyError before any I/O -- a bad key must not cost a
  // database round trip.
  const bounds = periodBounds(kind, periodKey);
  const { startUtc, endUtc } = periodRangeUtc(kind, periodKey, timezone);

  const prevKey = previousPeriodKey(kind, periodKey);
  const prevRange = periodRangeUtc(kind, prevKey, timezone);

  const completedRows = await readCompleted(supabase, athleteId, startUtc, endUtc);

  // Partial-failure isolation, mirroring reports/context.ts: these reads are
  // independent, and one failing degrades its own field rather than aborting
  // the review.
  const [plannedRes, prevRes, historyRes, planRes, profileRes] = await Promise.allSettled([
    // service-role: explicit user filter required
    supabase
      .from("planned_workouts")
      .select("id, sport, scheduled_date, planned_load, structure")
      .eq("athlete_id", athleteId)
      .is("deleted_at", null)
      .gte("scheduled_date", bounds.start)
      .lte("scheduled_date", bounds.end)
      .order("id", { ascending: true }),
    readCompleted(supabase, athleteId, prevRange.startUtc, prevRange.endUtc),
    // Does ANY training history exist before this period? This is what
    // separates "no prior period to compare against" (a first-ever week) from
    // "prior period existed and was empty" (a break). `limit(1)` -- the
    // question is existence, not content.
    // service-role: explicit user filter required
    supabase
      .from("completed_workouts")
      .select("id")
      .eq("athlete_id", athleteId)
      .is("deleted_at", null)
      .lt("started_at", startUtc.toISOString())
      .limit(1),
    // service-role: explicit user filter required
    supabase
      .from("plans")
      .select("id, event_date, event_type")
      .eq("athlete_id", athleteId)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle(),
    // service-role: explicit user filter required
    supabase
      .from("athlete_profiles")
      .select("manual_fields, baselines")
      .eq("user_id", athleteId)
      .maybeSingle(),
  ]);

  const matches = await readMatches(
    supabase,
    completedRows.map((r) => r.id),
  );

  const planned: AggregatePlannedWorkout[] =
    plannedRes.status === "fulfilled" && !plannedRes.value.error
      ? ((plannedRes.value.data ?? []) as RawPlannedRow[]).map((r) => ({
          id: r.id,
          sport: r.sport,
          scheduled_date: r.scheduled_date,
          planned_load: r.planned_load,
          structure: r.structure,
        }))
      : [];

  const hasPriorHistory =
    historyRes.status === "fulfilled" &&
    !historyRes.value.error &&
    (historyRes.value.data ?? []).length > 0;

  let previous: PeriodContext["previous"] = null;
  if (hasPriorHistory) {
    const prevRows = prevRes.status === "fulfilled" ? prevRes.value : [];
    const prevMatches = await readMatches(
      supabase,
      prevRows.map((r) => r.id),
    );
    previous = { key: prevKey, completed: toAggregateCompleted(prevRows, prevMatches) };
  }

  const plan: PeriodPlanContext | null =
    planRes.status === "fulfilled" && !planRes.value.error && planRes.value.data
      ? {
          id: (planRes.value.data as RawPlanRow).id,
          event_date: (planRes.value.data as RawPlanRow).event_date,
          goal: (planRes.value.data as RawPlanRow).event_type,
        }
      : null;

  const profile: PeriodProfileContext | null =
    profileRes.status === "fulfilled" && !profileRes.value.error && profileRes.value.data
      ? {
          manual_fields: (profileRes.value.data as RawProfileRow).manual_fields ?? {},
          baselines: (profileRes.value.data as RawProfileRow).baselines ?? {},
        }
      : null;

  return {
    athleteId,
    kind,
    periodKey,
    bounds,
    timezone,
    completed: toAggregateCompleted(completedRows, matches),
    planned,
    previous,
    plan,
    profile,
  };
}
