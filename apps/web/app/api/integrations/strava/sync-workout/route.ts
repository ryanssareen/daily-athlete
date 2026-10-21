import { NextResponse } from "next/server";

import { resolveAuth } from "@/auth/bearer";
import { createClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { getWorkoutById } from "@/db/workouts";
import { hydrateStravaWorkout } from "@/strava/hydrate-workout";
import { StravaReauthRequired, StravaRateLimited } from "@/strava/errors";

// Thin wrapper around the shared `hydrateStravaWorkout` service. Same
// service is also called from the auto-hydration server action on first
// workout-detail view (Unit 4).
//
// Accepts the browser cookie session or a mobile `Authorization: Bearer`
// token (resolveAuth), so the app can trigger the same enrichment the web
// detail page does on first view.

export async function POST(req: Request) {
  const supabase = await createClient();
  const { user, error: authErr } = await resolveAuth(supabase, req);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let workoutId: string;
  try {
    const body = await req.json();
    workoutId = body.workoutId;
    if (!workoutId || typeof workoutId !== "string") throw new Error("missing workoutId");
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const admin = createAdminClient();

  // A Bearer caller has no cookie session, so the cookie-bound client has no
  // user for RLS to key on. Read via the service role; getWorkoutById filters
  // on athlete_id explicitly.
  // service-role: explicit user filter required
  const workout = await getWorkoutById(admin, user.id, workoutId);
  if (!workout) return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  if (!workout.strava_activity_id) {
    return NextResponse.json({ error: "Workout has no Strava activity ID" }, { status: 400 });
  }

  try {
    const { summary_stats } = await hydrateStravaWorkout({
      admin,
      userId: user.id,
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
