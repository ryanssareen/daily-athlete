import { NextResponse } from "next/server";

import { getUserWithRoles } from "@/auth/roles";
import { createAdminClient } from "@/db/admin";
import { createClient } from "@/auth/server";
import { getWorkoutById } from "@/db/workouts";
import { createStravaClient } from "@/strava/client";
import { StravaReauthRequired, StravaRateLimited } from "@/strava/errors";
import { StravaActivitySchema } from "@/strava/schemas";
import { buildSummaryStats } from "@/strava/build-summary-stats";

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
  const newStats = buildSummaryStats(activity);

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
