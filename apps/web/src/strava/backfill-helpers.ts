import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { insertOrUpdateStravaCompletedWorkout } from "@/db/completed-workouts";
import { insertHydrationPayload } from "@/db/strava-raw-payloads";
import { updateBackfillStatus } from "@/db/backfill-status";
import type { StravaClient } from "@/strava/client";
import { normalizeSport } from "@/strava/sport-normalization";
import type { StravaActivity } from "@/strava/schemas";

/** Returns true if the auth.users row still exists. */
export async function userExists(
  admin: SupabaseClient,
  userId: string
): Promise<boolean> {
  // service-role: explicit user filter required
  const { data } = await admin
    .from("users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  return data !== null;
}

export async function markBackfillInProgress(
  admin: SupabaseClient,
  userId: string
): Promise<void> {
  await updateBackfillStatus(admin, userId, {
    provider: "strava",
    state: "in_progress",
    started_at: new Date().toISOString(),
    completed: 0,
    estimated_total: 200,
  });
}

/**
 * Persist a page of activities. Returns the count of rows inserted/updated.
 * Caps at `cap` so total never exceeds MAX_ACTIVITIES.
 * Does NOT return any activity data — Inngest Cloud stores step returns
 * unencrypted, so raw Strava payloads must never leave this function.
 */
export async function processActivityPage({
  admin,
  userId,
  activities,
  cap,
}: {
  admin: SupabaseClient;
  userId: string;
  activities: StravaActivity[];
  cap: number;
}): Promise<number> {
  const toProcess = activities.slice(0, cap);
  for (const activity of toProcess) {
    const sport = normalizeSport(activity.sport_type);
    const row = {
      athlete_id: userId,
      source: "strava" as const,
      strava_activity_id: activity.id,
      started_at: activity.start_date,
      sport,
      distance_m: activity.distance != null ? Math.round(activity.distance) : null,
      duration_s: activity.moving_time ?? activity.elapsed_time ?? null,
      summary_stats: buildSummaryStats(activity),
    };
    await insertOrUpdateStravaCompletedWorkout(admin, row);
    await insertHydrationPayload(admin, { userId, activity });
  }
  return toProcess.length;
}

export async function markBackfillComplete({
  admin,
  client,
  userId,
  total,
}: {
  admin: SupabaseClient;
  client: StravaClient;
  userId: string;
  total: number;
}): Promise<void> {
  await updateBackfillStatus(admin, userId, {
    provider: "strava",
    state: "complete",
    completed: total,
    estimated_total: total,
    completed_at: new Date().toISOString(),
  });
  // touchLastUsed once per logical session, not per activity (avoids 200 writes)
  await client.touchLastUsed();
}

/**
 * Parse X-RateLimit-Usage to compute milliseconds until the next 15-min
 * boundary. Strava resets the 15-min quota at the start of each window
 * aligned to :00, :15, :30, :45. Falls back to 5 minutes if headers are
 * missing or unparseable.
 */
export function computeRateLimitBackoffMs(response: Response | null): number {
  const FALLBACK_MS = 5 * 60 * 1000;
  if (!response) return FALLBACK_MS;

  try {
    const usage = response.headers.get("x-ratelimit-usage");
    if (!usage) return FALLBACK_MS;
    const parts = usage.split(",").map((s) => Number(s.trim()));
    if (parts.length < 1 || !Number.isFinite(parts[0]!)) return FALLBACK_MS;
    // If we haven't hit 15-min limit, back off the default
    const fifteenMinUsed = parts[0]!;
    const limitHeader = response.headers.get("x-ratelimit-limit");
    const limits = limitHeader?.split(",").map((s) => Number(s.trim()));
    const fifteenMinLimit = limits && Number.isFinite(limits[0]!) ? limits[0]! : 100;
    if (fifteenMinUsed < fifteenMinLimit) return FALLBACK_MS;

    // Back off to next 15-min window boundary
    const now = Date.now();
    const msInWindow = now % (15 * 60 * 1000);
    const msToNextWindow = 15 * 60 * 1000 - msInWindow + 5000; // +5s buffer
    return msToNextWindow;
  } catch {
    return FALLBACK_MS;
  }
}

function buildSummaryStats(activity: StravaActivity): Record<string, unknown> {
  const stats: Record<string, unknown> = {};
  if (activity.average_speed != null) stats.average_speed = activity.average_speed;
  if (activity.max_speed != null) stats.max_speed = activity.max_speed;
  if (activity.average_heartrate != null) stats.average_heartrate = activity.average_heartrate;
  if (activity.max_heartrate != null) stats.max_heartrate = activity.max_heartrate;
  if (activity.average_watts != null) stats.average_watts = activity.average_watts;
  if (activity.total_elevation_gain != null) stats.total_elevation_gain = activity.total_elevation_gain;
  if (activity.suffer_score != null) stats.suffer_score = activity.suffer_score;
  if (activity.name) stats.name = activity.name;
  return stats;
}
