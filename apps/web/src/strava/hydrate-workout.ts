import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildSummaryStats, mergeEnrichment } from "@/strava/build-summary-stats";
import { createStravaClient } from "@/strava/client";
import {
  deriveFtpFromZones,
  deriveHrMaxFromZones,
  fetchActivityLaps,
  fetchActivityZones,
  fetchAthleteZones,
} from "@/strava/endpoints";
import {
  StravaActivitySchema,
  type StravaLap,
  type StravaZone,
  type StravaAthleteZones,
} from "@/strava/schemas";
import { computeIF, computeTSS } from "@/lib/training-math";

// Single source of truth for fully hydrating a completed_workouts row
// from Strava: detail + laps + zones + athlete-zones (for FTP/HRmax),
// merged into one summary_stats blob, written in a single UPDATE.
//
// Called from two places:
//   1. The manual sync route (`/api/integrations/strava/sync-workout`)
//      — user clicked "Sync from Strava" on the detail page.
//   2. The auto-hydration server action on first detail-page view
//      (Unit 4) — `summary_stats.hydrated_at` is absent.
//
// All four Strava calls run in parallel via `Promise.all` so wall-clock
// latency is bounded by the slowest single call (typically /activities
// at 200-400ms) rather than the sum.
//
// Returns the new `summary_stats` so callers (the auto-hydration path)
// can avoid a second DB read after the UPDATE.

interface HydrateArgs {
  admin: SupabaseClient;
  userId: string;
  workoutId: string;
  stravaActivityId: number;
  durationSec: number | null;
}

export interface HydrateResult {
  summary_stats: Record<string, unknown>;
}

export async function hydrateStravaWorkout(args: HydrateArgs): Promise<HydrateResult> {
  const { admin, userId, workoutId, stravaActivityId, durationSec } = args;
  const client = createStravaClient(userId, admin);

  // Detail is must-succeed; the three enrichment calls are best-effort.
  // We run all four in parallel but use Promise.allSettled for the
  // enrichment trio so a transient /zones 5xx doesn't discard a perfectly
  // good /activities detail fetch. On rejection we treat that endpoint's
  // contribution as "not available" (null) and still persist the rest.
  // (REL-001 fix.)
  const detailPromise = client.fetch(`/activities/${stravaActivityId}`);
  const [detailRes, lapsResult, zonesResult, athleteZonesResult] = await Promise.all([
    detailPromise,
    Promise.allSettled([
      fetchActivityLaps(client, stravaActivityId),
    ]).then((r) => r[0]),
    Promise.allSettled([
      fetchActivityZones(client, stravaActivityId),
    ]).then((r) => r[0]),
    Promise.allSettled([
      fetchAthleteZones(client),
    ]).then((r) => r[0]),
  ]);

  if (!detailRes.ok) {
    throw new Error(`Strava /activities/${stravaActivityId} returned ${detailRes.status}`);
  }
  const rawDetail = await detailRes.json();
  const activity = StravaActivitySchema.parse(rawDetail);

  // Unwrap allSettled results, swallowing rejections (one transient 5xx
  // should not block hydration). Surface them in logs so on-call can see
  // partial-failure rates.
  const laps: StravaLap[] | null = lapsResult.status === "fulfilled" ? lapsResult.value : (logEnrichmentFailure("laps", lapsResult.reason), null);
  const zones: StravaZone[] | null = zonesResult.status === "fulfilled" ? zonesResult.value : (logEnrichmentFailure("zones", zonesResult.reason), null);
  const athleteZones: StravaAthleteZones | null = athleteZonesResult.status === "fulfilled" ? athleteZonesResult.value : (logEnrichmentFailure("athlete_zones", athleteZonesResult.reason), null);

  // A rejection means Strava never answered, so the enrichment is missing
  // for a retryable reason. mergeEnrichment withholds `hydrated_at` in that
  // case so the next render tries again instead of freezing the row with
  // laps/zones permanently absent (#103). `athleteZones` is deliberately
  // excluded: it is athlete-scoped, not activity-scoped, so a failure there
  // is not a reason to re-fetch this activity's laps and zones.
  const enrichmentFailed =
    lapsResult.status === "rejected" || zonesResult.status === "rejected";

  // Derive FTP + HRmax + IF + TSS from the athlete zones we just fetched.
  // Snapshotted onto summary_stats so historic readings stay stable when
  // FTP later changes. Computed once here rather than mutated in place
  // on baseStats (MAINT-7 consistency with mergeEnrichment immutability).
  const derived = deriveTrainingMetrics({
    activity,
    athleteZones,
    durationSec: durationSec ?? activity.moving_time ?? activity.elapsed_time ?? 0,
  });

  const baseStats = { ...buildSummaryStats(activity), ...derived };

  // Empty arrays are meaningful — they mean "we looked, there's nothing."
  // null means "we didn't look or the endpoint 404'd / errored." Persist
  // accordingly via mergeEnrichment.
  const merged = mergeEnrichment(baseStats, laps, zones, enrichmentFailed);

  // Conditional UPDATE: only write if no other concurrent render has
  // already hydrated this row. The `summary_stats->>'hydrated_at' IS NULL`
  // guard makes the second of two concurrent calls a no-op rather than a
  // clobbering write, and also gracefully handles the case where this
  // call resolved *after* a Promise.race timeout already returned to the
  // caller (REL-002 + CORR-2 fixes). When the guard skips the UPDATE we
  // re-read the row so the caller still gets back authoritative data.
  // service-role: explicit user filter required
  const { data: updated, error } = await admin
    .from("completed_workouts")
    .update({ summary_stats: merged })
    .eq("id", workoutId)
    .eq("athlete_id", userId)
    .is("summary_stats->>hydrated_at", null)
    .select("summary_stats");

  if (error) {
    throw new Error(`hydrateStravaWorkout: DB update failed: ${error.message}`);
  }

  // Update returned 0 rows → another concurrent call already wrote.
  // Re-read to get the canonical state so the caller doesn't render
  // stale-and-unenriched.
  if (!updated || updated.length === 0) {
    // service-role: explicit user filter required
    const { data: existing } = await admin
      .from("completed_workouts")
      .select("summary_stats")
      .eq("id", workoutId)
      .eq("athlete_id", userId)
      .maybeSingle();
    if (existing?.summary_stats) {
      return { summary_stats: existing.summary_stats as Record<string, unknown> };
    }
  }

  return { summary_stats: merged };
}

function logEnrichmentFailure(endpoint: string, reason: unknown): void {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.warn(`[hydrate-workout] ${endpoint} enrichment failed: ${message}`);
}

interface DeriveArgs {
  activity: ReturnType<typeof StravaActivitySchema.parse>;
  athleteZones: StravaAthleteZones | null;
  durationSec: number;
}

/** Pure projection of training-load metrics. Returns only the keys we have data for. */
function deriveTrainingMetrics({ activity, athleteZones, durationSec }: DeriveArgs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ftp = deriveFtpFromZones(athleteZones);
  const hrMax = deriveHrMaxFromZones(athleteZones);
  const np = activity.weighted_average_watts ?? activity.average_watts ?? null;

  if (ftp != null) out.ftp_at_workout = ftp;
  if (hrMax != null) out.hr_max_at_workout = hrMax;
  if (np != null && ftp != null) {
    const intensityFactor = computeIF(np, ftp);
    const tss = computeTSS(durationSec, np, ftp);
    if (intensityFactor != null) out.intensity_factor = Number(intensityFactor.toFixed(3));
    if (tss != null) out.tss = Math.round(tss);
  }
  return out;
}
