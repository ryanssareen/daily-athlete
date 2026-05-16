// Zod schemas for Strava API response bodies. Used in place of `as` casts
// so the backfill function validates at the boundary rather than trusting
// Strava's wire format.
//
// Only fields the app actually reads are declared; extra fields pass through
// .strip() (Zod default). This intentionally omits GPS/stream data — see
// migration 0008 comment block (R18 / Strava ToS: no raw stream samples).

import { z } from "zod";

export const StravaActivitySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().default(""),
  sport_type: z.string().default("other"),
  start_date: z.string(),
  elapsed_time: z.number().int().nonnegative().optional(),
  moving_time: z.number().int().nonnegative().optional(),
  distance: z.number().nonnegative().optional(),
  // Summary stats that are safe to store (no stream-level samples)
  average_speed: z.number().nonnegative().optional(),
  max_speed: z.number().nonnegative().optional(),
  average_heartrate: z.number().nonnegative().optional(),
  max_heartrate: z.number().nonnegative().optional(),
  average_watts: z.number().nonnegative().optional(),
  total_elevation_gain: z.number().nonnegative().optional(),
  suffer_score: z.number().nonnegative().nullable().optional(),
});

export type StravaActivity = z.infer<typeof StravaActivitySchema>;
