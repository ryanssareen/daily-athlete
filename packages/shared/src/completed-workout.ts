// Mirror of public.completed_workouts from
// supabase/migrations/0008_completed_workouts_and_matches.sql. The canonical
// record of every real-world effort -- Strava-sourced or manually logged.
//
// SQL invariants enforced at the DB layer (NOT Zod refinements here):
// - source='strava' implies strava_activity_id IS NOT NULL
//   (CHECK completed_workouts_strava_activity_id_required).
// - superseded_by_id != id (CHECK completed_workouts_no_self_supersede).
// - Partial unique on (athlete_id, strava_activity_id) WHERE
//   strava_activity_id IS NOT NULL -- R15 Strava webhook idempotency.
//
// The Zod row schema validates shape only; it does not duplicate the SQL
// constraints. App-layer write paths should rely on Zod for shape and on
// SQL CHECKs for semantic invariants.

import { z } from "zod";

import { SportSchema } from "./planned-workout";

// Matches the SQL CHECK: source IN ('strava', 'manual').
// 'strava' rows are written by the webhook handler (product plan Unit 2.1);
// 'manual' rows are athlete-logged ad-hoc workouts.
export const CompletedWorkoutSourceSchema = z.enum(["strava", "manual"]);
export type CompletedWorkoutSource = z.infer<typeof CompletedWorkoutSourceSchema>;

// summary_stats JSONB. This was previously `z.object({}).passthrough()`.
// Unit 4 (deterministic training-load) pins the fields the load proxy reads
// so the CTL/ATL/TSB series is computed against a typed, value-semantic
// contract rather than `unknown`. The shape stays OPEN (`.passthrough()`) so
// every existing producer key (polyline, laps, zones, kilojoules, suffer_score,
// pr_count, hydrated_at, etc.) and any future Unit 2.2 key still validate; we
// only *narrow the types of the keys the load math depends on*.
//
// Two naming generations coexist on purpose:
//   - Currently persisted (apps/web/src/strava/hydrate-workout.ts +
//     build-summary-stats.ts): `tss`, `intensity_factor`, `average_heartrate`,
//     `max_heartrate`, `weighted_average_watts`, `average_watts`,
//     `average_speed`, `manual`, `device_watts`, `ftp_at_workout`,
//     `hr_max_at_workout`.
//   - Forward-declared canonical names from product plan Unit 2.2 (Strava
//     normalization): `tss_equivalent`, `avg_hr_bpm`, `max_hr_bpm`,
//     `normalized_power_w`, `avg_power_w`, `max_power_w`, `avg_pace_s_per_km`.
// The load proxy reads whichever is present, preferring the canonical name.
// Pinning both lets the load math compile against this contract today and keep
// working once Unit 2.2 renames keys.
//
// Per R18 / Strava ToS, NO raw 1Hz stream samples appear here -- only summary
// statistics.
//
// Size note: ce:review #55 item 7 (and #51 item 4) flag the Realtime ~10MB
// per-message cap. No Zod .max() refinement yet; tighten when prompt-driven
// payload bounds are known.
export const SummaryStatsSchema = z
  .object({
    // --- Training-load (the load proxy's primary signal) ---
    // Currently-persisted power-based TSS (rounded integer in hydrate-workout).
    tss: z.number().optional(),
    // Forward-declared canonical name (Unit 2.2). TSS-equivalent across sports.
    tss_equivalent: z.number().optional(),
    intensity_factor: z.number().optional(),

    // --- Heart rate (drives the duration/HR-aware conservative fallback) ---
    average_heartrate: z.number().optional(),
    max_heartrate: z.number().optional(),
    avg_hr_bpm: z.number().optional(),
    max_hr_bpm: z.number().optional(),
    hr_max_at_workout: z.number().optional(),

    // --- Power ---
    weighted_average_watts: z.number().optional(),
    average_watts: z.number().optional(),
    normalized_power_w: z.number().optional(),
    avg_power_w: z.number().optional(),
    max_power_w: z.number().optional(),
    ftp_at_workout: z.number().optional(),
    // `device_watts === false` means estimated power (preserve explicit false).
    device_watts: z.boolean().optional(),

    // --- Pace / speed ---
    average_speed: z.number().optional(),
    max_speed: z.number().optional(),
    avg_pace_s_per_km: z.number().optional(),

    // --- Provenance flags the load proxy uses for confidence/eligibility ---
    manual: z.boolean().optional(),
    hydrated_at: z.string().optional(),
  })
  .passthrough();
export type SummaryStats = z.infer<typeof SummaryStatsSchema>;

// Strava activity IDs are BIGINT in SQL. Current Strava IDs (~10^10) fit
// comfortably in JS's 53-bit safe integer range; revisit if Strava ever
// issues IDs larger than 2^53.
//
// distance_m is NUMERIC (variable precision); duration_s is INTEGER. Both
// nullable to support sparse manual entries that don't carry these fields.
//
// Timestamps use .datetime({ offset: true }) per the packages/shared
// convention (PostgREST returns TIMESTAMPTZ in offset notation).
export const CompletedWorkoutRowSchema = z.object({
  id: z.string().uuid(),
  athlete_id: z.string().uuid(),
  source: CompletedWorkoutSourceSchema,
  strava_activity_id: z.number().int().nullable(),
  started_at: z.string().datetime({ offset: true }),
  sport: SportSchema,
  distance_m: z.number().nullable(),
  duration_s: z.number().int().nullable(),
  summary_stats: SummaryStatsSchema,
  superseded_by_id: z.string().uuid().nullable(),
  created_at: z.string().datetime({ offset: true }),
  deleted_at: z.string().datetime({ offset: true }).nullable(),
});

export type CompletedWorkoutRow = z.infer<typeof CompletedWorkoutRowSchema>;
