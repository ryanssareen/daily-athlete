import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { insertOrUpdateStravaCompletedWorkout } from "@/db/completed-workouts";
import { insertHydrationPayload } from "@/db/strava-raw-payloads";
import { updateBackfillStatus } from "@/db/backfill-status";
import type { StravaClient } from "@/strava/client";
import { normalizeSport } from "@/strava/sport-normalization";
import { buildSummaryStats } from "@/strava/build-summary-stats";
import { matchStravaToPlanned } from "@/strava/auto-match";
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

// How many activities to persist concurrently. Each activity costs ~2 DB
// round-trips deep (the insert+hydration pair runs in parallel, then the
// match). Strava→Supabase round-trips dominate wall-clock, so processing a
// page strictly serially (the old behaviour) meant ~200 × 3 sequential
// round-trips — enough to blow Vercel's 60s function budget mid-page and
// leave the run hard-killed at `completed: 0`. A bounded pool collapses that
// to ~(200/8) sequential batches without flooding the connection pooler.
const PROCESS_CONCURRENCY = 8;

/** Persist one activity: completed_workouts row + hydration payload + match. */
async function processActivity(
  admin: SupabaseClient,
  userId: string,
  activity: StravaActivity
): Promise<void> {
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

  // The completed-workout upsert and the hydration insert are independent of
  // each other; the match needs the resulting workout id, so it follows.
  const [completedWorkoutId] = await Promise.all([
    insertOrUpdateStravaCompletedWorkout(admin, row),
    insertHydrationPayload(admin, { userId, activity }),
  ]);

  // Non-fatal: a match failure must not abort the backfill loop.
  try {
    await matchStravaToPlanned(admin, {
      athleteId: userId,
      completedWorkoutId,
      sport,
      startedAt: activity.start_date,
      durationS: row.duration_s,
    });
  } catch {
    // Log structured context only — never log raw activity payload.
    console.info(
      "[backfill.match] failed",
      JSON.stringify({ athlete_id: userId, strava_activity_id: activity.id })
    );
  }
}

/**
 * Persist a page of activities. Returns the count of rows inserted/updated.
 * Caps at `cap` so total never exceeds MAX_ACTIVITIES.
 * Does NOT return any activity data — Inngest Cloud stores step returns
 * unencrypted, so raw Strava payloads must never leave this function.
 *
 * Processes the page in bounded-concurrency batches. After each batch it
 * reports cumulative progress via `onProgress` so the poller sees the bar
 * advance (instead of frozen at 0) and progress is durable even if a later
 * batch is interrupted. `shouldStop` is checked BETWEEN batches so the
 * caller can bail out cleanly before the function's time budget runs out;
 * the count returned then reflects only the batches that actually landed.
 */
export async function processActivityPage({
  admin,
  userId,
  activities,
  cap,
  onProgress,
  shouldStop,
}: {
  admin: SupabaseClient;
  userId: string;
  activities: StravaActivity[];
  cap: number;
  onProgress?: (processedInPage: number) => void | Promise<void>;
  shouldStop?: () => boolean;
}): Promise<number> {
  const toProcess = activities.slice(0, cap);
  let processed = 0;

  for (let i = 0; i < toProcess.length; i += PROCESS_CONCURRENCY) {
    if (shouldStop?.()) break;
    const batch = toProcess.slice(i, i + PROCESS_CONCURRENCY);
    await Promise.all(batch.map((activity) => processActivity(admin, userId, activity)));
    processed += batch.length;
    if (onProgress) await onProgress(processed);
  }

  return processed;
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

