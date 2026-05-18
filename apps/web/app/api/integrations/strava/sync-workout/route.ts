import { NextResponse } from "next/server";

import { getUserWithRoles } from "@/auth/roles";
import { createAdminClient } from "@/db/admin";
import { createClient } from "@/auth/server";
import { getWorkoutById } from "@/db/workouts";
import { hydrateStravaWorkout } from "@/strava/hydrate-workout";
import { StravaReauthRequired, StravaRateLimited } from "@/strava/errors";

// Thin wrapper around the shared `hydrateStravaWorkout` service. Same
// service is also called from the auto-hydration server action on first
// workout-detail view (Unit 4).

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

  try {
    const { summary_stats } = await hydrateStravaWorkout({
      admin,
      userId: session.user.id,
      workoutId,
      stravaActivityId: workout.strava_activity_id,
      durationSec: workout.duration_s,
    });
    return NextResponse.json({ ok: true, stats: summary_stats });
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
    console.error("[sync-workout] hydration failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not sync workout" }, { status: 502 });
  }
}
