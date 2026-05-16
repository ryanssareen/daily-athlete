import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { StravaActivity } from "@/strava/schemas";

// Fields that must never be stored — stream-level samples violate R18 and
// Strava ToS §2.14. The whitelist approach below is safer than a blacklist:
// only explicitly listed fields pass through to the payload column.
const SAFE_SUMMARY_FIELDS: ReadonlySet<keyof StravaActivity> = new Set([
  "id",
  "name",
  "sport_type",
  "start_date",
  "elapsed_time",
  "moving_time",
  "distance",
  "average_speed",
  "max_speed",
  "average_heartrate",
  "max_heartrate",
  "average_watts",
  "total_elevation_gain",
  "suffer_score",
]);

function sanitizePayload(activity: StravaActivity): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SAFE_SUMMARY_FIELDS) {
    if (key in activity) {
      out[key] = activity[key];
    }
  }
  return out;
}

/**
 * Insert a hydration-kind raw payload row for archival / audit purposes.
 * Payload is whitelist-sanitized: no GPS streams, no HR samples.
 *
 * // service-role: explicit user filter required (userId is the filter)
 */
export async function insertHydrationPayload(
  admin: SupabaseClient,
  { userId, activity }: { userId: string; activity: StravaActivity }
): Promise<void> {
  // service-role: explicit user filter required
  const { error } = await admin.from("strava_raw_payloads").insert({
    user_id: userId,
    kind: "hydration",
    payload: sanitizePayload(activity),
  });

  if (error) {
    throw new Error(`insertHydrationPayload failed: ${error.message}`);
  }
}
