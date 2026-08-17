import "server-only";

import type { StravaActivity, StravaLap, StravaZone } from "@/strava/schemas";

// Single source of truth for projecting a Strava activity into the
// `completed_workouts.summary_stats` JSONB column. Used by both the
// backfill flow (`backfill-helpers.ts`) and the on-demand sync /
// hydration flow (`sync-workout/route.ts`, `hydrate-workout.ts`).
//
// Add new fields here, not in callers. Every conditional add follows the
// "only persist when present" rule so we never store `null` or `undefined`
// keys — absence is meaningful (the renderer keys on presence).

export function buildSummaryStats(activity: StravaActivity): Record<string, unknown> {
  const stats: Record<string, unknown> = {};

  // Identity / context
  if (activity.name) stats.name = activity.name;
  if (activity.description != null) stats.description = activity.description;
  if (activity.start_date_local) stats.start_date_local = activity.start_date_local;
  if (activity.utc_offset != null) stats.utc_offset = activity.utc_offset;

  // Speed / pace
  if (activity.average_speed != null) stats.average_speed = activity.average_speed;
  if (activity.max_speed != null) stats.max_speed = activity.max_speed;

  // Heart rate
  if (activity.average_heartrate != null) stats.average_heartrate = activity.average_heartrate;
  if (activity.max_heartrate != null) stats.max_heartrate = activity.max_heartrate;
  if (activity.has_heartrate != null) stats.has_heartrate = activity.has_heartrate;

  // Power
  if (activity.average_watts != null) stats.average_watts = activity.average_watts;
  if (activity.weighted_average_watts != null) {
    stats.weighted_average_watts = activity.weighted_average_watts;
  }
  if (activity.max_watts != null) stats.max_watts = activity.max_watts;
  if (activity.kilojoules != null) stats.kilojoules = activity.kilojoules;
  // `device_watts === false` means estimated power — preserve the explicit false.
  if (activity.device_watts != null) stats.device_watts = activity.device_watts;

  // Cadence
  if (activity.average_cadence != null) stats.average_cadence = activity.average_cadence;

  // Elevation
  if (activity.total_elevation_gain != null) {
    stats.total_elevation_gain = activity.total_elevation_gain;
  }
  if (activity.elev_high != null) stats.elev_high = activity.elev_high;
  if (activity.elev_low != null) stats.elev_low = activity.elev_low;

  // Environment / load
  if (activity.average_temp != null) stats.average_temp = activity.average_temp;
  if (activity.calories != null) stats.calories = activity.calories;
  if (activity.suffer_score != null) stats.suffer_score = activity.suffer_score;

  // Flags
  if (activity.trainer != null) stats.trainer = activity.trainer;
  if (activity.commute != null) stats.commute = activity.commute;
  if (activity.manual != null) stats.manual = activity.manual;

  // Counts
  if (activity.pr_count != null) stats.pr_count = activity.pr_count;
  if (activity.achievement_count != null) stats.achievement_count = activity.achievement_count;

  // Map
  const poly = activity.map?.summary_polyline;
  if (poly && poly.length > 0) stats.polyline = poly;

  return stats;
}

/**
 * Merge enriched lap + zone data onto an existing `summary_stats` object.
 * Always produces a new object; never mutates the input. Pass `null` for
 * laps/zones when the endpoint returned no data (404 / empty) so callers
 * don't need to decide whether to attach an empty array.
 *
 * `hydrated_at` is the "don't hydrate this row again" marker: both
 * `shouldHydrate()` and the conditional UPDATE in `hydrateStravaWorkout`
 * key off its presence. Stamping it unconditionally meant a single
 * transient /laps or /zones throw permanently froze the row with no
 * enrichment and no retry path (#103).
 *
 * Pass `enrichmentFailed` when an endpoint *threw* — that is the only
 * retryable case, and withholding the stamp is what lets the next page
 * view try again. A 404 or `[]` is a definitive answer ("we looked,
 * there's nothing"), so `laps`/`zones` being `null` is NOT on its own a
 * reason to retry: treating it as one would re-hit Strava on every render
 * for activities that will never have zones.
 */
export function mergeEnrichment(
  base: Record<string, unknown>,
  laps: StravaLap[] | null,
  zones: StravaZone[] | null,
  enrichmentFailed = false
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  if (laps != null) merged.laps = laps;
  if (zones != null) merged.zones = zones;
  if (!enrichmentFailed) {
    merged.hydrated_at = new Date().toISOString();
  }
  return merged;
}
