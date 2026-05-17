import { NextResponse } from "next/server";

import { getUserWithRoles } from "@/auth/roles";
import { createAdminClient } from "@/db/admin";
import { createClient } from "@/auth/server";
import { getWorkoutById } from "@/db/workouts";
import { createStravaClient } from "@/strava/client";
import { StravaReauthRequired, StravaRateLimited } from "@/strava/errors";
import { StravaActivitySchema } from "@/strava/schemas";

function buildStats(activity: ReturnType<typeof StravaActivitySchema.parse>): Record<string, unknown> {
  const stats: Record<string, unknown> = {};
  if (activity.name) stats.name = activity.name;
  if (activity.average_speed != null) stats.average_speed = activity.average_speed;
  if (activity.max_speed != null) stats.max_speed = activity.max_speed;
  if (activity.average_heartrate != null) stats.average_heartrate = activity.average_heartrate;
  if (activity.max_heartrate != null) stats.max_heartrate = activity.max_heartrate;
  if (activity.average_watts != null) stats.average_watts = activity.average_watts;
  if (activity.total_elevation_gain != null) stats.total_elevation_gain = activity.total_elevation_gain;
  if (activity.suffer_score != null) stats.suffer_score = activity.suffer_score;
  if (activity.average_cadence != null) stats.average_cadence = activity.average_cadence;
  const poly = activity.map?.summary_polyline;
  if (poly && poly.length > 0) stats.polyline = poly;
  return stats;
}

export async function POST(req: Request) {
  const session = await getUserWithRoles();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let workoutId: string;
  try {
    const body = await req.json();
    workoutId = body.workoutId;
    if (!workoutId || typeof workoutId !== "string") throw new Error("missing workoutId");
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const supabase = await createClient();
  const workout = await getWorkoutById(supabase, session.user.id, workoutId);
  if (!workout) return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  if (!workout.strava_activity_id) {
    return NextResponse.json({ error: "Workout has no Strava activity ID" }, { status: 400 });
  }

  const admin = createAdminClient();
  const stravaClient = createStravaClient(session.user.id, admin);

  let res: Response;
  try {
    res = await stravaClient.fetch(`/activities/${workout.strava_activity_id}`);
  } catch (err) {
    if (err instanceof StravaReauthRequired) {
      return NextResponse.json(
        { error: "Strava connection expired — reconnect Strava in Settings" },
        { status: 401 }
      );
    }
    if (err instanceof StravaRateLimited) {
      return NextResponse.json(
        { error: "Strava rate limit reached, try again in a few minutes" },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: "Could not reach Strava" }, { status: 502 });
  }

  if (res.status === 429) return NextResponse.json({ error: "Strava rate limit reached, try again shortly" }, { status: 429 });
  if (!res.ok) return NextResponse.json({ error: `Strava returned ${res.status}` }, { status: 502 });

  const raw = await res.json();
  let activity: ReturnType<typeof StravaActivitySchema.parse>;
  try {
    activity = StravaActivitySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "Unexpected data from Strava" }, { status: 502 });
  }
  const newStats = buildStats(activity);

  // service-role: explicit user filter required
  const { error } = await admin
    .from("completed_workouts")
    .update({ summary_stats: newStats })
    .eq("id", workoutId)
    .eq("athlete_id", session.user.id);

  if (error) {
    console.error("[sync-workout] update failed", error.message);
    return NextResponse.json({ error: "DB update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, stats: newStats });
}
