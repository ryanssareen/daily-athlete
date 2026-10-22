import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createStravaClient } from "@/strava/client";
import { fetchActivityHrStream } from "@/strava/endpoints";
import { StravaRateLimited, StravaReauthRequired } from "@/strava/errors";
import { toPerMinute, type HrMinutePoint } from "@/strava/hr-series";

export type HrSeriesResult =
  | { status: "ok"; points: HrMinutePoint[] }
  | { status: "unavailable" }
  | { status: "rate_limited" }
  | { status: "reauth_required" }
  | { status: "error" };

/**
 * Fetch the heart-rate stream from Strava right now and reduce it to
 * per-minute points. Nothing is persisted — see hr-series.ts. Shared by the
 * workout-detail page and GET /api/workouts/[id]/hr-series so web and mobile
 * render the same series.
 *
 * `admin` is the service-role client the Strava client needs for its token
 * row; the caller must already have verified the activity belongs to
 * `userId`.
 */
export async function loadHrSeries(args: {
  admin: SupabaseClient;
  userId: string;
  stravaActivityId: number;
  /** Runs also get cadence and pace overlaid on the HR series. */
  isRun?: boolean;
}): Promise<HrSeriesResult> {
  try {
    const client = createStravaClient(args.userId, args.admin);
    const stream = await fetchActivityHrStream(client, args.stravaActivityId, {
      runMetrics: args.isRun,
    });
    if (!stream) return { status: "unavailable" };
    const points = toPerMinute(stream.time, stream.heartrate, {
      cadence: stream.cadence,
      velocity: stream.velocity,
    });
    return points.length > 0 ? { status: "ok", points } : { status: "unavailable" };
  } catch (err) {
    if (err instanceof StravaRateLimited) return { status: "rate_limited" };
    if (err instanceof StravaReauthRequired) return { status: "reauth_required" };
    // Class name only: never echo a message that could carry upstream payload.
    console.warn(`[hr-series] fetch failed: ${err instanceof Error ? err.name : "unknown"}`);
    return { status: "error" };
  }
}
