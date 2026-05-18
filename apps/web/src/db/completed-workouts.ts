import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export interface CompletedWorkoutRow {
  athlete_id: string;
  source: "strava";
  strava_activity_id: number;
  started_at: string;
  sport: string;
  distance_m: number | null;
  duration_s: number | null;
  summary_stats: Record<string, unknown>;
}

/**
 * INSERT a Strava-sourced completed_workouts row. On 23505 (partial unique
 * index conflict on athlete_id + strava_activity_id), fall through to UPDATE
 * so at-least-once delivery from Strava is idempotent.
 *
 * Returns the UUID of the inserted or updated row so callers (backfill,
 * webhook handler) can pass it to matchStravaToPlanned.
 *
 * supabase-js .upsert() with onConflict cannot target a partial unique index
 * (raises 42P10 at runtime). The INSERT-catch-23505-UPDATE pattern is the
 * documented workaround.
 *
 * // service-role: explicit user filter required (row.athlete_id is user_id)
 */
export async function insertOrUpdateStravaCompletedWorkout(
  admin: SupabaseClient,
  row: CompletedWorkoutRow
): Promise<string> {
  // service-role: explicit user filter required
  const { data: inserted, error: insertErr } = await admin
    .from("completed_workouts")
    .insert(row)
    .select("id")
    .single();

  if (!insertErr) return inserted.id as string;

  if ((insertErr as { code?: string }).code !== "23505") {
    throw new Error(
      `insertOrUpdateStravaCompletedWorkout insert failed: ${insertErr.message}`
    );
  }

  // 23505: duplicate strava_activity_id for this athlete — update instead
  // service-role: explicit user filter required
  const { data: updated, error: updateErr } = await admin
    .from("completed_workouts")
    .update({
      sport: row.sport,
      started_at: row.started_at,
      distance_m: row.distance_m,
      duration_s: row.duration_s,
      summary_stats: row.summary_stats,
    })
    .eq("athlete_id", row.athlete_id)
    .eq("strava_activity_id", row.strava_activity_id)
    .select("id")
    .single();

  if (updateErr || !updated) {
    throw new Error(
      `insertOrUpdateStravaCompletedWorkout update fallback failed: ${updateErr?.message ?? "no data"}`
    );
  }

  return updated.id as string;
}
