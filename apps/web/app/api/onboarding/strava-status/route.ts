// GET /api/onboarding/strava-status
//
// Polled by the onboarding Strava step after the OAuth round-trip
// completes. Returns:
//   - `connected`: whether a strava_tokens row exists for this user
//   - `backfill_status`: the current backfill_status JSON from
//     athlete_profiles (shape: see strava-backfill.ts)
//
// The onboarding UI drives a progress bar from
// `completed / estimated_total` and transitions to the final profile
// step when state === "complete".

import { NextResponse } from "next/server";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { hasStravaToken } from "@/db/strava-tokens";

// Auth: SSR cookie (web onboarding) or Bearer token (Flutter app, which uses
// this to decide between "Connect Strava" and "Connected" in Settings).
export async function GET(request: Request): Promise<NextResponse> {
  const supabase = await createServerClient();
  const { user } = await resolveAuth(supabase, request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const connected = await hasStravaToken(admin, user.id);

  // service-role: explicit user filter required
  const { data, error } = await admin
    .from("athlete_profiles")
    .select("backfill_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "db_read_failed", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    connected,
    backfill_status: data?.backfill_status ?? {},
  });
}
