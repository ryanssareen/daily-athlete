// Gather the context the generator + validator need: the athlete's current
// load state (seed CTL/ATL + recent weekly TSS) and a sparse-profile flag (A5
// fallback). The load derivation is a PURE function (testable, deterministic);
// the DB-reading wrapper is thin.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  addDays,
  buildLoadSeries,
  dayDiff,
  type LoadWorkoutInput,
} from "@/training-load";

import type { PlanLoadContext } from "./validate-plan";

export interface GenerationContext {
  load: PlanLoadContext;
  /** True when training history is too thin to assume an experienced athlete
   * (A5 near-beginner generator framing). */
  sparseProfile: boolean;
}

// Below this many load-eligible completed workouts we treat the profile as
// sparse and bias the plan conservative.
export const SPARSE_PROFILE_WORKOUT_THRESHOLD = 8;
// Window for the "recent weekly TSS" baseline the first plan week is checked
// against.
const RECENT_WINDOW_DAYS = 28;
// How far back to read history for the seed CTL/ATL. CTL/ATL are EWMAs with
// ~42d / ~7d time constants, so efforts older than ~9x the CTL tau contribute
// <0.1% to the seed at asOf. Bounding the fetch keeps it from scaling with
// athlete tenure (a multi-year athlete otherwise drags their whole history
// through buildLoadSeries on every generation) without moving the seed. See the
// derivePlanLoadContext losslessness test.
const HISTORY_WINDOW_DAYS = 400;

/** Pure: derive the load context the validator/prompt consume from completed
 * workouts as of a given day. */
export function derivePlanLoadContext(
  completed: LoadWorkoutInput[],
  asOf: string
): PlanLoadContext {
  const state = buildLoadSeries(completed, { asOf });
  const recent = state.series.filter((p) => {
    const age = dayDiff(p.date, asOf);
    return age >= 0 && age <= RECENT_WINDOW_DAYS;
  });
  const recentWeeklyTss =
    recent.length > 0
      ? (recent.reduce((s, p) => s + p.tss, 0) / recent.length) * 7
      : undefined;
  return { seedCtl: state.ctl, seedAtl: state.atl, recentWeeklyTss };
}

/**
 * Read the athlete's completed workouts (service-role; explicit user filter)
 * and build the generation context. Used by the Inngest worker (Unit 5).
 */
export async function gatherGenerationContext(
  admin: SupabaseClient,
  athleteId: string,
  asOf: string
): Promise<GenerationContext> {
  // service-role: explicit user filter required
  const { data, error } = await admin
    .from("completed_workouts")
    .select("started_at, duration_s, summary_stats")
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    // Bounded history window (see HISTORY_WINDOW_DAYS) — lossless for the EWMA
    // seed, but caps the read so it doesn't scale with athlete tenure.
    .gte("started_at", addDays(asOf, -HISTORY_WINDOW_DAYS));
  if (error) throw error;

  const completed: LoadWorkoutInput[] = (data ?? []).map((row) => ({
    started_at: row.started_at as string,
    duration_s: (row.duration_s as number | null) ?? null,
    summary_stats: row.summary_stats as Record<string, unknown> | null,
  }));

  return {
    load: derivePlanLoadContext(completed, asOf),
    sparseProfile: completed.length < SPARSE_PROFILE_WORKOUT_THRESHOLD,
  };
}
