// Zod schemas for Strava API response bodies. Used in place of `as` casts
// so the backfill function validates at the boundary rather than trusting
// Strava's wire format.
//
// Only fields the app actually reads are declared; extra fields pass through
// .strip() (Zod default). This intentionally omits 1Hz stream samples (per
// migration 0008 comment block — R18 / Strava ToS). Aggregate fields, lap
// summaries, zone-time distributions, and athlete-level zone definitions
// are explicitly allowed.

import { z } from "zod";

export const StravaActivitySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().default(""),
  sport_type: z.string().default("other"),
  start_date: z.string(),
  start_date_local: z.string().optional(),
  utc_offset: z.number().optional(),
  elapsed_time: z.number().int().nonnegative().optional(),
  moving_time: z.number().int().nonnegative().optional(),
  distance: z.number().nonnegative().optional(),
  // Summary stats that are safe to store (no stream-level samples)
  average_speed: z.number().nonnegative().optional(),
  max_speed: z.number().nonnegative().optional(),
  average_heartrate: z.number().nonnegative().optional(),
  max_heartrate: z.number().nonnegative().optional(),
  average_watts: z.number().nonnegative().optional(),
  weighted_average_watts: z.number().nonnegative().optional(),
  max_watts: z.number().nonnegative().optional(),
  kilojoules: z.number().nonnegative().optional(),
  calories: z.number().nonnegative().optional(),
  total_elevation_gain: z.number().nonnegative().optional(),
  elev_high: z.number().optional(),
  elev_low: z.number().optional(),
  average_temp: z.number().optional(),
  suffer_score: z.number().nonnegative().nullable().optional(),
  average_cadence: z.number().nonnegative().optional(),
  // Booleans / flags
  device_watts: z.boolean().optional(),
  has_heartrate: z.boolean().optional(),
  trainer: z.boolean().optional(),
  commute: z.boolean().optional(),
  manual: z.boolean().optional(),
  // Counts
  pr_count: z.number().int().nonnegative().optional(),
  achievement_count: z.number().int().nonnegative().optional(),
  // Description / annotation
  description: z.string().nullable().optional(),
  // Context: device, workout flavour, place, social counters. Aggregates only.
  device_name: z.string().nullable().optional(),
  workout_type: z.number().int().nullable().optional(),
  timezone: z.string().nullable().optional(),
  location_city: z.string().nullable().optional(),
  location_state: z.string().nullable().optional(),
  location_country: z.string().nullable().optional(),
  kudos_count: z.number().int().nonnegative().optional(),
  comment_count: z.number().int().nonnegative().optional(),
  athlete_count: z.number().int().nonnegative().optional(),
  total_photo_count: z.number().int().nonnegative().optional(),
  // Present on the detail response only (inline with /activities/{id}).
  gear: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      distance: z.number().nonnegative().optional(),
    })
    .nullable()
    .optional(),
  // Per-km / per-mile aggregates computed by Strava. Detail response only.
  splits_metric: z.array(z.lazy(() => StravaSplitSchema)).optional(),
  best_efforts: z.array(z.lazy(() => StravaBestEffortSchema)).optional(),
  // summary_polyline is a compressed route string (not stream samples).
  // It is safe to store and display per Strava ToS §2.
  map: z
    .object({ summary_polyline: z.string().optional() })
    .optional()
    .nullable(),
});

// Strava-computed aggregates; no stream indices stored (see StravaLapSchema).
export const StravaSplitSchema = z.object({
  split: z.number().int().nonnegative(),
  distance: z.number().nonnegative(),
  elapsed_time: z.number().int().nonnegative(),
  moving_time: z.number().int().nonnegative().optional(),
  average_speed: z.number().nonnegative().optional(),
  average_heartrate: z.number().nonnegative().optional(),
  elevation_difference: z.number().optional(),
});
export type StravaSplit = z.infer<typeof StravaSplitSchema>;

export const StravaBestEffortSchema = z.object({
  name: z.string(),
  distance: z.number().nonnegative(),
  elapsed_time: z.number().int().nonnegative(),
  moving_time: z.number().int().nonnegative().optional(),
  pr_rank: z.number().int().nullable().optional(),
});
export type StravaBestEffort = z.infer<typeof StravaBestEffortSchema>;

export type StravaActivity = z.infer<typeof StravaActivitySchema>;

// ─── /activities/{id}/laps ────────────────────────────────────────────────────

// Strava-computed lap summaries. Aggregates only — no stream indices stored.
// Per migration 0008, `start_index`/`end_index` (which reference 1Hz stream
// positions) are intentionally NOT captured even though Strava returns them.
export const StravaLapSchema = z.object({
  lap_index: z.number().int().nonnegative(),
  split: z.number().int().nonnegative().optional(),
  name: z.string().optional(),
  elapsed_time: z.number().int().nonnegative(),
  moving_time: z.number().int().nonnegative(),
  distance: z.number().nonnegative(),
  average_speed: z.number().nonnegative().optional(),
  max_speed: z.number().nonnegative().optional(),
  average_heartrate: z.number().nonnegative().optional(),
  max_heartrate: z.number().nonnegative().optional(),
  average_cadence: z.number().nonnegative().optional(),
  average_watts: z.number().nonnegative().optional(),
  total_elevation_gain: z.number().nonnegative().optional(),
});
export type StravaLap = z.infer<typeof StravaLapSchema>;

export const StravaLapsResponseSchema = z.array(StravaLapSchema);

// ─── /activities/{id}/zones ───────────────────────────────────────────────────

// Strava-computed zone-time distributions. Aggregate buckets (time spent in
// each HR or power zone) — not the raw HR/power samples themselves.
export const StravaZoneBucketSchema = z.object({
  min: z.number(),
  max: z.number(),
  time: z.number().int().nonnegative(),
});

export const StravaZoneSchema = z.object({
  type: z.enum(["heartrate", "power"]),
  sensor_based: z.boolean().optional(),
  custom_zones: z.boolean().optional(),
  distribution_buckets: z.array(StravaZoneBucketSchema),
});
export type StravaZone = z.infer<typeof StravaZoneSchema>;

export const StravaZonesResponseSchema = z.array(StravaZoneSchema);

// ─── /athlete/zones ───────────────────────────────────────────────────────────

// Athlete's configured HR + power zones. Used to derive FTP (from the last
// power zone's lower bound) and HR-max bucket labels. Cached on
// athlete_profiles.manual_fields.strava_zones; refresh every 7 days.
export const StravaAthleteZoneRangeSchema = z.object({
  min: z.number(),
  max: z.number(),
});

export const StravaAthleteZonesResponseSchema = z.object({
  heart_rate: z
    .object({
      custom_zones: z.boolean().optional(),
      zones: z.array(StravaAthleteZoneRangeSchema),
    })
    .optional(),
  power: z
    .object({
      zones: z.array(StravaAthleteZoneRangeSchema),
    })
    .optional(),
});
export type StravaAthleteZones = z.infer<typeof StravaAthleteZonesResponseSchema>;

// ─── /activities/{id}/streams (heart rate only) ───────────────────────────────

// Fetched live to draw the per-minute HR chart and reduced to per-minute
// averages in memory (see hr-series.ts). NEVER persisted: raw 1Hz samples are
// forbidden by migration 0008 / Strava ToS, so this schema describes a
// transient wire shape only.
export const StravaHrStreamResponseSchema = z.object({
  time: z.object({ data: z.array(z.number()) }).optional(),
  heartrate: z.object({ data: z.array(z.number()) }).optional(),
  cadence: z.object({ data: z.array(z.number()) }).optional(),
  velocity_smooth: z.object({ data: z.array(z.number()) }).optional(),
  altitude: z.object({ data: z.array(z.number()) }).optional(),
  watts: z.object({ data: z.array(z.number()) }).optional(),
});
export type StravaHrStreamResponse = z.infer<typeof StravaHrStreamResponseSchema>;

// ─── /athletes/{id}/stats ─────────────────────────────────────────────────────

// Strava-computed lifetime / year / recent totals. Aggregates only, so they
// are safe to display (and cache briefly) per Strava ToS.
export const StravaTotalsSchema = z.object({
  count: z.number().int().nonnegative().default(0),
  distance: z.number().nonnegative().default(0),
  moving_time: z.number().nonnegative().default(0),
  elevation_gain: z.number().nonnegative().default(0),
});
export type StravaTotals = z.infer<typeof StravaTotalsSchema>;

export const StravaAthleteStatsSchema = z.object({
  recent_run_totals: StravaTotalsSchema.optional(),
  recent_ride_totals: StravaTotalsSchema.optional(),
  recent_swim_totals: StravaTotalsSchema.optional(),
  ytd_run_totals: StravaTotalsSchema.optional(),
  ytd_ride_totals: StravaTotalsSchema.optional(),
  ytd_swim_totals: StravaTotalsSchema.optional(),
  all_run_totals: StravaTotalsSchema.optional(),
  all_ride_totals: StravaTotalsSchema.optional(),
  all_swim_totals: StravaTotalsSchema.optional(),
});
export type StravaAthleteStats = z.infer<typeof StravaAthleteStatsSchema>;
