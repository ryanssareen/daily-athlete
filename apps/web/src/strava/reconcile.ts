import "server-only";

// Reconcile sweep: a polling fallback that re-pulls each connected athlete's
// recent Strava activities and inserts any the real-time webhook missed.
//
// WHY THIS EXISTS (issue #97 follow-up): auto-sync of new activities is
// otherwise 100% webhook-driven. Any event dropped while the webhook is
// misconfigured (missing/rotated STRAVA_WEBHOOK_SUBSCRIPTION_ID), the app is
// down, the token needs re-auth, or Strava rate-limits us is lost forever —
// there was no retry and no cron that re-pulled missed activities, so a single
// config gap became an invisible, multi-week outage. This sweep closes that
// gap: even if every webhook event is dropped, the next reconcile run recovers
// the window.
//
// SAFE TO RE-RUN: both writes downstream are idempotent —
// `insertOrUpdateStravaCompletedWorkout` upserts on (athlete_id,
// strava_activity_id) and `matchStravaToPlanned` guards against duplicate
// matches — so re-processing an activity is a no-op. We still pre-filter to the
// genuinely-missing activities so `recovered` is a truthful count and we don't
// generate needless writes/re-matches every run.
//
// Like all Strava paths, this is blocked while the Strava app is `Inactive`
// (403 on every API call). It restores resilience to the webhook layer; it is
// not a workaround for an un-reactivated app.

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { StravaBackfillErrorCode } from "@da2/shared";

import { processActivityPage } from "@/strava/backfill-helpers";
import { createStravaClient } from "@/strava/client";
import {
  StravaKeyRotationError,
  StravaRateLimited,
  StravaReauthRequired,
  classifyError,
} from "@/strava/errors";
import { StravaActivitySchema } from "@/strava/schemas";

// Lookback window for the reconcile pull. Deliberately much wider than the
// cron interval (every 6h) so that even a multi-day webhook/app outage fully
// recovers on the first successful run afterwards. Tunable — widen it if the
// app can be down longer than this between reconcile runs.
export const RECONCILE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

// One page of recent activities covers the lookback window for any realistic
// athlete; the cap defends against a pathological account without unbounded
// API cost. `after` already bounds the result server-side.
const PER_PAGE = 100;
const MAX_ACTIVITIES = 100;

export interface UserReconcileResult {
  userId: string;
  /** Activities Strava returned inside the lookback window. */
  fetched: number;
  /** Activities that were MISSING locally and got inserted this run. */
  recovered: number;
  ok: boolean;
  /** Closed error code when ok=false; never carries a raw Strava message. */
  errorCode?: StravaBackfillErrorCode;
}

export interface ReconcileSweepResult {
  processed: number;
  recovered: number;
  failed: number;
  /** Users not reached because the soft deadline was hit (never silent). */
  skipped: number;
  results: UserReconcileResult[];
}

// Stop starting new per-user reconciles ~10s before Vercel's 60s hard kill so
// the route can still return a real summary instead of being killed mid-sweep.
const SWEEP_SOFT_DEADLINE_MS = 50_000;
// Bound fan-out so a sweep never bursts past Strava's app-wide 100-req/15-min
// budget in one tick (one API call per user).
const SWEEP_CONCURRENCY = 5;

/**
 * Which of `ids` already have a completed_workouts row for this athlete.
 *
 * Intentionally does NOT filter out soft-deleted rows: if an athlete deleted
 * an activity (or a webhook `delete` soft-deleted it), we must NOT resurrect it
 * on the next reconcile. A present id — live or soft-deleted — means "leave it
 * alone".
 */
async function fetchExistingActivityIds(
  admin: SupabaseClient,
  userId: string,
  ids: number[]
): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  // service-role: explicit user filter required
  const { data, error } = await admin
    .from("completed_workouts")
    .select("strava_activity_id")
    .eq("athlete_id", userId)
    .in("strava_activity_id", ids);
  if (error) {
    throw new Error(`fetchExistingActivityIds failed: ${error.message}`);
  }
  return new Set(
    (data ?? []).map((r) => (r as { strava_activity_id: number }).strava_activity_id)
  );
}

/**
 * Reconcile a single athlete: pull the recent-activity window and insert only
 * the activities missing locally. Never throws — every failure is caught and
 * returned as a closed `errorCode` so one athlete's bad token can't abort the
 * sweep.
 */
export async function reconcileStravaForUser(
  admin: SupabaseClient,
  userId: string,
  opts: { nowMs: number; lookbackMs?: number }
): Promise<UserReconcileResult> {
  const lookbackMs = opts.lookbackMs ?? RECONCILE_LOOKBACK_MS;
  const afterEpoch = Math.floor((opts.nowMs - lookbackMs) / 1000);

  try {
    const client = createStravaClient(userId, admin);
    const res = await client.fetch(
      `/athlete/activities?after=${afterEpoch}&per_page=${PER_PAGE}&page=1`
    );

    if (res.status === 429) {
      return { userId, fetched: 0, recovered: 0, ok: false, errorCode: "rate_limited" };
    }
    if (!res.ok) {
      // Includes 403 Application Status Inactive — the app-level block that
      // stops every Strava call until the app is reactivated.
      return { userId, fetched: 0, recovered: 0, ok: false, errorCode: "unknown" };
    }

    const activities = z
      .array(StravaActivitySchema)
      .parse(await res.json())
      .slice(0, MAX_ACTIVITIES);

    if (activities.length === 0) {
      return { userId, fetched: 0, recovered: 0, ok: true };
    }

    const existing = await fetchExistingActivityIds(
      admin,
      userId,
      activities.map((a) => a.id)
    );
    const missing = activities.filter((a) => !existing.has(a.id));

    const recovered =
      missing.length === 0
        ? 0
        : await processActivityPage({
            admin,
            userId,
            activities: missing,
            cap: missing.length,
          });

    if (recovered > 0) {
      console.info(
        "[strava.reconcile] recovered_missed_activities",
        JSON.stringify({ user_id: userId, fetched: activities.length, recovered })
      );
    }

    return { userId, fetched: activities.length, recovered, ok: true };
  } catch (err) {
    const errorCode: StravaBackfillErrorCode =
      err instanceof StravaReauthRequired
        ? "needs_reauth"
        : err instanceof StravaKeyRotationError
          ? "key_rotation"
          : err instanceof StravaRateLimited
            ? "rate_limited"
            : classifyError(err);
    console.info(
      "[strava.reconcile] user_failed",
      JSON.stringify({ user_id: userId, error_code: errorCode })
    );
    return { userId, fetched: 0, recovered: 0, ok: false, errorCode };
  }
}

/** All user_ids with a strava_tokens row (i.e. currently connected athletes). */
export async function listConnectedStravaUserIds(
  admin: SupabaseClient
): Promise<string[]> {
  // service-role: cross-user query is the reconcile sweep's explicit purpose
  const { data, error } = await admin.from("strava_tokens").select("user_id");
  if (error) {
    throw new Error(`listConnectedStravaUserIds failed: ${error.message}`);
  }
  return (data ?? []).map((r) => (r as { user_id: string }).user_id);
}

/**
 * Reconcile every connected athlete, in bounded-concurrency batches, stopping
 * cleanly before the function's time budget runs out. Users not reached before
 * the deadline are reported as `skipped` (never silently dropped) — the next
 * run picks them up.
 */
export async function reconcileAllStravaUsers(
  admin: SupabaseClient,
  opts: { nowMs: number; lookbackMs?: number; deadlineMs?: number }
): Promise<ReconcileSweepResult> {
  const deadlineMs = opts.deadlineMs ?? SWEEP_SOFT_DEADLINE_MS;
  // Wall-clock start for the soft deadline. Captured internally (not from
  // opts.nowMs) so the deadline is independent of the lookback reference
  // time — opts.nowMs only anchors the `after=` window each user is pulled
  // against, which callers may set to a fixed value (e.g. in tests).
  const sweepStartMs = Date.now();
  const userIds = await listConnectedStravaUserIds(admin);

  const results: UserReconcileResult[] = [];
  let index = 0;
  const elapsed = (): number => Date.now() - sweepStartMs;

  while (index < userIds.length && elapsed() < deadlineMs) {
    const batch = userIds.slice(index, index + SWEEP_CONCURRENCY);
    index += batch.length;
    const batchResults = await Promise.all(
      batch.map((userId) =>
        reconcileStravaForUser(admin, userId, {
          nowMs: opts.nowMs,
          lookbackMs: opts.lookbackMs,
        })
      )
    );
    results.push(...batchResults);
  }

  const skipped = userIds.length - index;
  if (skipped > 0) {
    console.warn(
      "[strava.reconcile] sweep_deadline_reached",
      JSON.stringify({ total: userIds.length, processed: index, skipped })
    );
  }

  return {
    processed: results.length,
    recovered: results.reduce((sum, r) => sum + r.recovered, 0),
    failed: results.filter((r) => !r.ok).length,
    skipped,
    results,
  };
}
