import "server-only";

// Thin typed wrappers around the three Strava endpoints we hydrate
// workout-detail pages from. Each wrapper:
//   1. Calls the shared StravaClient (which handles token refresh, 401
//      classification, rate-limit header capture, and timeouts).
//   2. Treats 404 as "no data" (null / empty), not an error — laps/zones
//      are commonly absent for activities and athletes.
//   3. Lets `StravaRateLimited` / `StravaReauthRequired` bubble — both
//      are typed errors callers can class-switch on.
//   4. Validates the response body with Zod before returning, so callers
//      never see Strava's raw wire shape.

import { StravaError } from "./errors";
import {
  StravaAthleteZonesResponseSchema,
  StravaLapsResponseSchema,
  StravaZonesResponseSchema,
  type StravaAthleteZones,
  type StravaLap,
  type StravaZone,
} from "./schemas";
import type { StravaClient } from "./client";

/**
 * Fetch the Strava-computed lap summaries for an activity. Returns
 * `null` when Strava 404s (activity has no laps array — rare but
 * happens for trainer rides). Throws on any other non-OK response.
 */
export async function fetchActivityLaps(
  client: StravaClient,
  activityId: number
): Promise<StravaLap[] | null> {
  const res = await client.fetch(`/activities/${activityId}/laps`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new StravaError(
      "unexpected",
      `Strava /activities/${activityId}/laps returned ${res.status}`
    );
  }
  const raw = await res.json();
  return StravaLapsResponseSchema.parse(raw);
}

/**
 * Fetch the Strava-computed zone-time distribution (HR + power) for an
 * activity. Strava returns an empty array — not 404 — when the athlete
 * has no zones configured or the activity has no HR/power data, so the
 * common "no data" case shows up as `[]`. Callers should treat both
 * `[]` and `null` as "no zones to render."
 */
export async function fetchActivityZones(
  client: StravaClient,
  activityId: number
): Promise<StravaZone[] | null> {
  const res = await client.fetch(`/activities/${activityId}/zones`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new StravaError(
      "unexpected",
      `Strava /activities/${activityId}/zones returned ${res.status}`
    );
  }
  const raw = await res.json();
  return StravaZonesResponseSchema.parse(raw);
}

/**
 * Fetch the athlete's configured HR + power zones (their FTP-derived
 * power thresholds and HR zones). Returns `null` when Strava 404s or
 * returns an empty object — athletes without configured zones have
 * neither power nor heart_rate keys.
 */
export async function fetchAthleteZones(
  client: StravaClient
): Promise<StravaAthleteZones | null> {
  const res = await client.fetch(`/athlete/zones`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new StravaError(
      "unexpected",
      `Strava /athlete/zones returned ${res.status}`
    );
  }
  const raw = await res.json();
  const parsed = StravaAthleteZonesResponseSchema.parse(raw);
  // Treat "all keys absent" as "no zones configured" — callers should
  // not have to distinguish `{}` from `null`.
  if (parsed.heart_rate == null && parsed.power == null) return null;
  return parsed;
}

/**
 * Derive the athlete's FTP from their configured Strava power zones.
 *
 * Strava encodes power zones as `Array<{ min, max }>` ordered from
 * lowest to highest. Per Coggan's 6-zone model (which Strava follows),
 * Z5 starts at ~106% FTP and is open-ended (max ≥ 1000W). The simplest
 * defensible read is: FTP ≈ the `min` of the last zone divided by 1.06,
 * but Strava itself doesn't publish the multiplier. A more robust read
 * — and the one our UI needs — is the value at the threshold between
 * Z4 (max 105% FTP) and Z5, so:
 *
 *   FTP ≈ Z4.max / 1.05  (since Strava sets Z4.max = floor(1.05 * FTP))
 *
 * If we have fewer than 5 zones (athlete uses a custom set), fall back
 * to the last zone's `min` and accept the ±5% imprecision — IF/TSS are
 * already approximations.
 *
 * Returns `null` when no power zones are configured.
 */
export function deriveFtpFromZones(zones: StravaAthleteZones | null): number | null {
  const powerZones = zones?.power?.zones;
  if (!powerZones || powerZones.length === 0) return null;
  // Prefer the Z4→Z5 transition when 5+ zones exist
  if (powerZones.length >= 5) {
    const z4 = powerZones[3];
    if (z4 && Number.isFinite(z4.max) && z4.max > 0) {
      return Math.round(z4.max / 1.05);
    }
  }
  const last = powerZones[powerZones.length - 1];
  if (last && Number.isFinite(last.min) && last.min > 0) return last.min;
  return null;
}

/**
 * Derive HR-max from the athlete's HR zones — Strava sets the last HR
 * zone's `max` to the athlete's HR-max (or 220 - age fallback). Returns
 * `null` when no HR zones are configured.
 */
export function deriveHrMaxFromZones(zones: StravaAthleteZones | null): number | null {
  const hrZones = zones?.heart_rate?.zones;
  if (!hrZones || hrZones.length === 0) return null;
  const last = hrZones[hrZones.length - 1];
  if (last && Number.isFinite(last.max) && last.max > 0) return last.max;
  return null;
}
