import "server-only";

import type { StravaActivity } from "@/strava/schemas";

export function buildSummaryStats(activity: StravaActivity): Record<string, unknown> {
  const stats: Record<string, unknown> = {};
  if (activity.average_speed != null) stats.average_speed = activity.average_speed;
  if (activity.max_speed != null) stats.max_speed = activity.max_speed;
  if (activity.average_heartrate != null) stats.average_heartrate = activity.average_heartrate;
  if (activity.max_heartrate != null) stats.max_heartrate = activity.max_heartrate;
  if (activity.average_watts != null) stats.average_watts = activity.average_watts;
  if (activity.total_elevation_gain != null) stats.total_elevation_gain = activity.total_elevation_gain;
  if (activity.suffer_score != null) stats.suffer_score = activity.suffer_score;
  if (activity.name) stats.name = activity.name;
  if (activity.average_cadence != null) stats.average_cadence = activity.average_cadence;
  const poly = activity.map?.summary_polyline;
  if (poly && poly.length > 0) stats.polyline = poly;
  return stats;
}
