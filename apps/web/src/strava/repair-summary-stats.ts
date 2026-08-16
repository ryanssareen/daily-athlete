import "server-only";

import { buildSummaryStats } from "@/strava/build-summary-stats";
import type { StravaActivity } from "@/strava/schemas";

// Repair projection for rows written by an older `buildSummaryStats`
// vintage. Athletes who backfilled before a field was added to the
// projection carry rows that are missing it permanently: the backfill is
// one-shot, and `hydrateStravaWorkout` only runs on first detail-page view
// (guarded on `hydrated_at IS NULL`), so most rows never get rewritten.
//
// Concretely: `average_cadence` landed in 0c9fbf4 (2026-05-17 14:00 UTC)
// and `has_heartrate` in a1e337b (2026-05-18). Any athlete whose backfill
// ran before those commits has rows with the fields absent even though
// Strava returned them.
//
// Every field these rows are missing is present on Strava's *summary*
// activity (`GET /athlete/activities`), so the repair does not need the
// per-activity detail endpoint — one API call per 200 activities instead
// of one per activity, which matters against Strava's 100-per-15-min cap.

/**
 * Fill keys that are absent from `existing` using a freshly-built
 * projection, without overwriting anything already stored.
 *
 * Fill-only is deliberate. The stored blob may carry enrichment that the
 * summary endpoint cannot reproduce — `laps`, `zones`, `tss`,
 * `intensity_factor`, `hydrated_at`, and detail-only fields such as
 * `description`, `calories`, `weighted_average_watts`, `max_watts`, and
 * `kilojoules`. A merge that let fresh values win would not clobber those
 * (they are simply absent from the fresh object), but it *would* silently
 * rewrite values a later hydration had already improved. Restricting the
 * repair to genuinely-missing keys keeps it idempotent and non-destructive:
 * running it twice is a no-op, and it can never make a row worse.
 *
 * Returns `null` when nothing was missing, so callers can skip the write
 * rather than issue an UPDATE that changes no bytes.
 */
export function fillMissingSummaryStats(
  existing: Record<string, unknown> | null | undefined,
  activity: StravaActivity
): { stats: Record<string, unknown>; added: string[] } | null {
  const base = existing ?? {};
  const fresh = buildSummaryStats(activity);

  const added: string[] = [];
  const stats: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(fresh)) {
    // `in` rather than a truthiness or `!= null` check: `buildSummaryStats`
    // only ever writes keys whose value is present, so a key that exists is
    // authoritative even when it holds `false` (`has_heartrate`,
    // `device_watts`, `trainer`) or `0` (`total_elevation_gain`).
    if (key in base) continue;
    stats[key] = value;
    added.push(key);
  }

  if (added.length === 0) return null;
  return { stats, added };
}
