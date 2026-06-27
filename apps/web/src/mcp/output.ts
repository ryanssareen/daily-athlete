import "server-only";

// Output projections for MCP tools. The connector NEVER returns a raw row: each
// read tool selects an explicit column list and (for completed workouts) curates
// the open `summary_stats` blob down to an allowlist. This is the operational
// core of R7 / AE3 — sensitive surfaces (Strava ids, derivation internals,
// device/FTP fields, soft-delete/audit columns) are absent by construction.

// Explicit SELECT lists (never "*").
export const PROFILE_SELECT = "manual_fields, updated_at";
export const COMPLETED_SELECT =
  "id, source, started_at, sport, distance_m, duration_s, summary_stats, created_at";
export const PLANNED_SELECT =
  "id, plan_id, scheduled_date, sport, structure, planned_load, status, rationale, version, created_at";
export const PLAN_SELECT =
  "id, status, event_type, event_date, source, created_at, archived_at";

// summary_stats keys the connector is allowed to surface (athlete-facing
// summaries only). Everything else — ftp_at_workout, hr_max_at_workout,
// normalized_power_w, weighted_average_watts, max_power_w, device_watts,
// hydrated_at, manual, polyline/laps/zones passthrough — is dropped.
const ALLOWED_SUMMARY_KEYS = [
  "tss",
  "tss_equivalent",
  "intensity_factor",
  "average_heartrate",
  "avg_hr_bpm",
  "max_heartrate",
  "max_hr_bpm",
  "average_watts",
  "avg_power_w",
  "average_speed",
  "avg_pace_s_per_km",
] as const;

// Fields that must NEVER appear in any tool payload. Asserted by the
// forbidden-fields test (operationalizes AE3 across the whole surface).
export const FORBIDDEN_OUTPUT_FIELDS = [
  "strava_activity_id",
  "baselines",
  "weekly_volume_ewma",
  "manual_field_edited_at",
  "superseded_by_id",
  "edited_by_user_id",
  "created_from_review_id",
  "deleted_at",
  "ftp_at_workout",
  "hr_max_at_workout",
  "normalized_power_w",
  "weighted_average_watts",
  "max_power_w",
  "device_watts",
  "hydrated_at",
] as const;

export function curateSummaryStats(
  stats: Record<string, unknown> | null | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!stats) return out;
  for (const key of ALLOWED_SUMMARY_KEYS) {
    const v = stats[key];
    if (typeof v === "number") out[key] = v;
  }
  return out;
}

/** Project a completed-workout row to its safe, curated shape. */
export function projectCompleted(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    source: row.source,
    started_at: row.started_at,
    sport: row.sport,
    distance_m: row.distance_m,
    duration_s: row.duration_s,
    stats: curateSummaryStats(row.summary_stats as Record<string, unknown> | null),
    created_at: row.created_at,
  };
}
