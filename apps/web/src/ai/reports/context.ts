import "server-only";

// Context assembly for per-workout reports
// (docs/plans/2026-08-18-001-feat-workout-reports-plan.md, Unit U4).
//
// `gatherReportContext` reads everything computeExecutionDelta (Unit U3) and
// buildFactSheet (Unit U5) need for ONE completed workout: the completed
// workout itself, its matched planned_workouts row (if any, via
// workout_matches), the athlete profile, the active plan's event date +
// goal, and a recent training-load snapshot as of the workout's day.
//
// Pattern: mirrors apps/web/src/ai/adaptive/context.ts's `gatherContext` --
// same Raw*Row + accessor-helper shape, same Promise.allSettled
// partial-failure isolation -- but NOT its security posture.
//
// SECURITY (AGENTS.md "RLS posture"): this module is DEFENCE-IN-DEPTH by
// construction -- exactly like adaptive/context.ts, every read below filters
// explicitly on `athlete_id = athleteId` (the two reads that do not --
// `workout_matches` by completed_workout_id, and the `planned_workouts`
// lookup inside resolveMatch -- are respectively keyed off an id this
// function has ALREADY proven belongs to `athleteId` via the fatal
// completed_workouts read, and re-filtered by athlete_id themselves). That
// hand-rolled filtering is what makes the module correct under EITHER client:
//
//   - a user-JWT client (`@supabase/ssr`, apps/web/src/auth/server.ts), where
//     RLS is a second, independent enforcement layer underneath the filters;
//   - a service-role client (`@/db/admin`), where the explicit filters ARE
//     the enforcement, per AGENTS.md's service-role contract.
//
// The route (U6) deliberately passes a SERVICE-ROLE client, because
// `resolveAuth` supports Bearer-token callers (mobile) and supabase-js's
// `auth.getUser(token)` validates a bearer token WITHOUT attaching it to the
// client -- a cookie-less mobile request would otherwise query Postgres as
// `anon`, `auth.uid()` would be NULL, and every RLS-scoped read would return
// zero rows. This mirrors /api/plans: user-JWT client for AUTH, admin client
// + explicit athlete filters for DATA. (Server components, which always have
// a cookie session, still pass the user-JWT client.)
//
// THE ONE INVARIANT THIS MODULE CANNOT CHECK: `athleteId` must be an
// AUTHENTICATED caller id, never a client-supplied value. Nothing downstream
// re-derives it. Every caller is responsible for that, and both callers today
// pass `user.id` straight off resolveAuth / getUserWithRoles.
//
// Degradation policy: only a missing/soft-deleted completed_workouts row is
// fatal (CompletedWorkoutNotFoundError) -- there is nothing to report on.
// Every other read is null-tolerant: a missing or soft-deleted-only match
// yields `match: null` (R4 -- unplanned effort is not an error state); a
// missing athlete_profiles row yields `profile: null`; a missing/absent
// active plan yields `plan: null`; a failed recent-load read degrades to an
// empty series (buildLoadSeries's own cold-start behavior). None of these
// throw.

import type { SupabaseClient } from "@supabase/supabase-js";

import { IntensityTargetSchema, type IntensityTarget, type WorkoutMatchMethod } from "@da2/shared";

import {
  addDays,
  buildLoadSeries,
  toDayKey,
  type LoadState,
  type LoadWorkoutInput,
} from "@/training-load";

// --- Shapes -----------------------------------------------------------------

/** The completed_workouts row fields the delta engine + fact sheet need. */
export interface ReportCompletedWorkout {
  id: string;
  sport: string;
  started_at: string;
  distance_m: number | null;
  duration_s: number | null;
  summary_stats: Record<string, unknown>;
  /** R21 manual/Strava merge trail -- non-null when this row was superseded. */
  superseded_by_id: string | null;
}

/**
 * The matched planned_workouts row, structural view. `structure` and
 * `planned_load` are preserved RAW (verbatim from the row) -- these are two
 * of the eight fields fingerprint.ts hashes per KTD4, and hashing must see
 * exactly what is stored, not a derived projection of it. `duration_s` /
 * `load` / `intensity_target` are pre-derived accessor fields (mirroring
 * `ContextPlannedWorkout` in adaptive/context.ts) so delta.ts (U3) and
 * fact-sheet.ts (U5) never need to re-parse the structure JSON themselves.
 */
export interface MatchedPlannedWorkout {
  id: string;
  scheduled_date: string;
  sport: string;
  status: string;
  /** Raw structure JSONB. KTD4 fingerprint input `planned_structure`. */
  structure: Record<string, unknown> | null;
  /** Raw planned_load column. KTD4 fingerprint input `planned_load` --
   * distinct from (and NOT overwritten by) the derived `load` below. */
  planned_load: number | null;
  /** Derived: structure.duration_s, defensively read (number or null). */
  duration_s: number | null;
  /** Derived: structure.load, falling back to the planned_load column. */
  load: number | null;
  /** Derived: structure.intensity_target, schema-validated (null if absent/malformed). */
  intensity_target: IntensityTarget | null;
  /** The workout_matches row this was resolved from -- see pickBestMatch. */
  match: {
    id: string;
    confidence: number;
    method: WorkoutMatchMethod;
    matched_at: string;
  };
}

export interface AthleteProfileContext {
  manual_fields: Record<string, unknown>;
  baselines: Record<string, unknown>;
}

/**
 * The active plan's event date + goal, best-effort (null when the athlete
 * has no active, non-deleted plan).
 */
export interface ActivePlanContext {
  id: string;
  event_date: string | null;
  /**
   * Sourced from `plans.event_type` -- see the U4 report-back for this call.
   * `plans` has no column literally named `goal`; `event_type` is the
   * athlete-authored free-text event description (e.g. "marathon", "70.3")
   * already treated as the goal-equivalent context input by
   * apps/web/src/ai/generation/prompts/generate-plan.ts's prompt builder, so
   * this module reuses it rather than inventing a second "goal" concept.
   */
  goal: string | null;
}

/** Everything the delta engine + fact sheet need, in one pass. */
export interface ReportContext {
  athleteId: string;
  completedWorkout: ReportCompletedWorkout;
  /** null when unmatched (R4/AE3) or the only match is soft-deleted. */
  match: MatchedPlannedWorkout | null;
  /** null when the athlete has no athlete_profiles row. Never throws. */
  profile: AthleteProfileContext | null;
  /** null when the athlete has no active, non-deleted plan. Never throws. */
  plan: ActivePlanContext | null;
  /** CTL/ATL/TSB as of the completed workout's calendar day. */
  recentLoad: LoadState;
}

export class CompletedWorkoutNotFoundError extends Error {
  constructor(completedWorkoutId: string) {
    super(`gatherReportContext: no visible completed_workouts row ${completedWorkoutId}`);
    this.name = "CompletedWorkoutNotFoundError";
  }
}

export interface GatherReportContextArgs {
  /** Either a user-JWT client (@supabase/ssr) or a service-role client
   * (@/db/admin) -- every read below is explicitly filtered on `athleteId`,
   * so both are safe. See the module header for why the route passes the
   * service-role one. */
  supabase: SupabaseClient;
  /** MUST be an authenticated caller's id, never client-supplied. */
  athleteId: string;
  completedWorkoutId: string;
}

// Bounded history window for the recent-load read, mirroring
// apps/web/src/ai/generation/context.ts's HISTORY_WINDOW_DAYS: CTL/ATL are
// EWMAs with ~42d/~7d time constants, so history older than ~400 days
// contributes negligibly to the load state as of the reported workout's day.
// Bounding the fetch keeps it from scaling with athlete tenure.
export const RECENT_LOAD_HISTORY_WINDOW_DAYS = 400;

// --- Gather -------------------------------------------------------------

/**
 * Gather the report context for one completed workout, scoped to
 * `athleteId` on every read. Throws CompletedWorkoutNotFoundError when
 * the workout does not exist or is not visible to the caller; every other
 * input degrades to null/empty rather than throwing.
 */
export async function gatherReportContext(
  args: GatherReportContextArgs
): Promise<ReportContext> {
  const { supabase, athleteId, completedWorkoutId } = args;

  // The completed workout is read FIRST (not folded into the Promise.allSettled
  // batch below) because its `started_at` day anchors the recent-load window --
  // unlike adaptive/context.ts's fatal read, this one is a genuine dependency
  // for a later query, not just an error-precedence convenience.
  const completedRes = await supabase
    .from("completed_workouts")
    .select("id, sport, started_at, distance_m, duration_s, summary_stats, superseded_by_id")
    .eq("id", completedWorkoutId)
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (completedRes.error) {
    throw new Error(
      `gatherReportContext: completed_workouts read failed for ${completedWorkoutId}: ${completedRes.error.message}`
    );
  }
  const completedRow = completedRes.data as RawCompletedWorkoutRow | null;
  if (!completedRow) throw new CompletedWorkoutNotFoundError(completedWorkoutId);

  const completedWorkout: ReportCompletedWorkout = {
    id: completedRow.id,
    sport: completedRow.sport,
    started_at: completedRow.started_at,
    distance_m: completedRow.distance_m,
    duration_s: completedRow.duration_s,
    summary_stats: completedRow.summary_stats ?? {},
    superseded_by_id: completedRow.superseded_by_id,
  };

  const asOfDay = toDayKey(completedWorkout.started_at);
  const historyStart = addDays(asOfDay, -RECENT_LOAD_HISTORY_WINDOW_DAYS);
  const historyEndExclusive = addDays(asOfDay, 1);

  // Partial-failure isolation, mirroring adaptive/context.ts: gather the
  // remaining independent reads concurrently, but a rejection/error on any
  // one of them degrades to null/empty rather than aborting the others.
  const [matchesRes, profileRes, planRes, loadRes] = await Promise.allSettled([
    supabase
      .from("workout_matches")
      .select("id, planned_workout_id, confidence, method, matched_at")
      .eq("completed_workout_id", completedWorkoutId)
      .is("deleted_at", null),
    supabase
      .from("athlete_profiles")
      .select("manual_fields, baselines")
      .eq("user_id", athleteId)
      .maybeSingle(),
    supabase
      .from("plans")
      .select("id, event_date, event_type")
      .eq("athlete_id", athleteId)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("completed_workouts")
      .select("started_at, duration_s, summary_stats")
      .eq("athlete_id", athleteId)
      .is("deleted_at", null)
      .gte("started_at", historyStart)
      .lt("started_at", historyEndExclusive),
  ]);

  const match = await resolveMatch(supabase, athleteId, matchesRes);

  const profile: AthleteProfileContext | null =
    profileRes.status === "fulfilled" && !profileRes.value.error && profileRes.value.data
      ? {
          manual_fields: (profileRes.value.data as RawProfileRow).manual_fields ?? {},
          baselines: (profileRes.value.data as RawProfileRow).baselines ?? {},
        }
      : null;

  const plan: ActivePlanContext | null =
    planRes.status === "fulfilled" && !planRes.value.error && planRes.value.data
      ? toActivePlanContext(planRes.value.data as RawPlanRow)
      : null;

  const loadHistory: LoadWorkoutInput[] =
    loadRes.status === "fulfilled" && !loadRes.value.error
      ? ((loadRes.value.data ?? []) as RawCompletedHistoryRow[]).map((r) => ({
          started_at: r.started_at,
          duration_s: r.duration_s,
          summary_stats: r.summary_stats,
        }))
      : [];

  const recentLoad = buildLoadSeries(loadHistory, { asOf: asOfDay });

  return { athleteId, completedWorkout, match, profile, plan, recentLoad };
}

function toActivePlanContext(row: RawPlanRow): ActivePlanContext {
  return { id: row.id, event_date: row.event_date, goal: row.event_type };
}

// --- Match resolution ---------------------------------------------------

interface RawWorkoutMatchRow {
  id: string;
  planned_workout_id: string;
  confidence: number;
  method: WorkoutMatchMethod;
  matched_at: string;
}

/**
 * Deterministic multi-match tiebreak (U4 test scenario: "workout with two
 * matches -> the higher-confidence row wins, deterministically").
 *
 * `workout_matches_one_per_completed` (migration 0008, a partial unique
 * index WHERE deleted_at IS NULL) should make more than one LIVE match per
 * completed workout impossible in practice -- this function exists so the
 * CODE never silently depends on that DB invariant holding for its
 * determinism. Row order from Postgres is never assumed to be stable.
 *
 * Tiebreak order:
 *   1. Highest `confidence` wins.
 *   2. Ties broken by the most recent `matched_at` (ISO-8601 string compare).
 *   3. A remaining tie (identical confidence AND matched_at) broken by the
 *      lexicographically GREATEST `id` -- arbitrary but total and stable, so
 *      the result never depends on the order rows were returned in.
 */
export function pickBestMatch(rows: RawWorkoutMatchRow[]): RawWorkoutMatchRow | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => (compareMatches(row, best) > 0 ? row : best));
}

function compareMatches(a: RawWorkoutMatchRow, b: RawWorkoutMatchRow): number {
  if (a.confidence !== b.confidence) return a.confidence - b.confidence;
  if (a.matched_at !== b.matched_at) return a.matched_at < b.matched_at ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

async function resolveMatch(
  supabase: SupabaseClient,
  athleteId: string,
  matchesRes: PromiseSettledResult<{
    data: RawWorkoutMatchRow[] | null;
    error: { message: string } | null;
  }>
): Promise<MatchedPlannedWorkout | null> {
  if (matchesRes.status !== "fulfilled" || matchesRes.value.error) return null;
  const best = pickBestMatch(matchesRes.value.data ?? []);
  if (!best) return null;

  const plannedRes = await supabase
    .from("planned_workouts")
    .select("id, scheduled_date, sport, structure, planned_load, status")
    .eq("id", best.planned_workout_id)
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (plannedRes.error || !plannedRes.data) return null;
  const row = plannedRes.data as RawPlannedWorkoutRow;

  return {
    id: row.id,
    scheduled_date: row.scheduled_date,
    sport: row.sport,
    status: row.status,
    structure: row.structure,
    planned_load: row.planned_load,
    duration_s: readStructureNumber(row.structure, "duration_s"),
    load: readStructureNumber(row.structure, "load") ?? row.planned_load,
    intensity_target: readStructureIntensityTarget(row.structure),
    match: {
      id: best.id,
      confidence: best.confidence,
      method: best.method,
      matched_at: best.matched_at,
    },
  };
}

// --- Raw row shapes -------------------------------------------------------

interface RawCompletedWorkoutRow {
  id: string;
  sport: string;
  started_at: string;
  distance_m: number | null;
  duration_s: number | null;
  summary_stats: Record<string, unknown> | null;
  superseded_by_id: string | null;
}

interface RawProfileRow {
  manual_fields: Record<string, unknown> | null;
  baselines: Record<string, unknown> | null;
}

interface RawPlanRow {
  id: string;
  event_date: string | null;
  event_type: string | null;
}

interface RawCompletedHistoryRow {
  started_at: string;
  duration_s: number | null;
  summary_stats: Record<string, unknown> | null | undefined;
}

interface RawPlannedWorkoutRow {
  id: string;
  scheduled_date: string;
  sport: string;
  structure: Record<string, unknown> | null;
  planned_load: number | null;
  status: string;
}

// --- Structure-field accessor helpers --------------------------------------
// Mirrors adaptive/context.ts's readStructureNumber: defensive reads over the
// permissive (`.passthrough()`) PlannedWorkoutStructureSchema (KTD8 -- a
// coach-authored or hand-edited structure may be missing any of these keys).

function readStructureNumber(
  structure: Record<string, unknown> | null,
  key: string
): number | null {
  if (!structure) return null;
  const v = structure[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readStructureIntensityTarget(
  structure: Record<string, unknown> | null
): IntensityTarget | null {
  if (!structure) return null;
  const parsed = IntensityTargetSchema.safeParse(structure.intensity_target);
  return parsed.success ? parsed.data : null;
}
