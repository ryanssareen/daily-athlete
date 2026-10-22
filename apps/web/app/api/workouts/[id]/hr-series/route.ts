// GET /api/workouts/[id]/hr-series — per-minute heart-rate series, fetched
// live from Strava and returned without being stored (migration 0008 / Strava
// ToS: no persisted stream samples). Used by the mobile app; the web detail
// page renders the same series server-side via loadHrSeries.
//
// Auth mirrors app/api/workouts/[id]/report: resolveAuth (cookie OR Bearer)
// for identity, service-role reads with an explicit athlete_id filter.

import "server-only";

import { NextResponse } from "next/server";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { getWorkoutById } from "@/db/workouts";
import { loadHrSeries } from "@/strava/load-hr-series";

export const dynamic = "force-dynamic";

// Derived Strava data for the signed-in athlete only: never cache shared.
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: HEADERS });
  }

  const { id } = await ctx.params;
  const admin = createAdminClient();
  // service-role: explicit user filter required
  const workout = await getWorkoutById(admin, user.id, id);
  if (!workout) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: HEADERS });
  }
  if (workout.source !== "strava" || !workout.strava_activity_id) {
    return NextResponse.json({ status: "unavailable" }, { status: 200, headers: HEADERS });
  }

  const result = await loadHrSeries({
    admin,
    userId: user.id,
    stravaActivityId: workout.strava_activity_id,
  });

  switch (result.status) {
    case "ok":
      return NextResponse.json(
        { status: "ok", resolution: "minute", points: result.points },
        { status: 200, headers: HEADERS }
      );
    case "rate_limited":
      return NextResponse.json({ status: "rate_limited" }, { status: 429, headers: HEADERS });
    case "reauth_required":
      return NextResponse.json({ status: "reauth_required" }, { status: 401, headers: HEADERS });
    case "error":
      return NextResponse.json({ status: "error" }, { status: 502, headers: HEADERS });
    default:
      return NextResponse.json({ status: "unavailable" }, { status: 200, headers: HEADERS });
  }
}
