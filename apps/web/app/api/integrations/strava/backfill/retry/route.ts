// POST /api/integrations/strava/backfill/retry
//
// Transitions backfill_status from 'failed' → 'queued' and kicks off a
// fresh backfill run via Next.js `after()`. Returns 202 immediately; the
// backfill runs after the response within Vercel's function timeout.
//
// Security posture:
// - Bearer-token auth (resolveAuth) accepts both mobile JWT and SSR cookie.
// - CSRF guard: rejects Sec-Fetch-Site: cross-site.
// - TOCTOU-safe: conditional UPDATE (state='failed') is the mutex.
// - service-role writes carry explicit user filter comments per AGENTS.md.

import { after, NextResponse } from "next/server";

import {
  BackfillStatusColumnSchema,
  type StravaBackfillRetryErrorCode,
} from "@da2/shared";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { runBackfillForUser } from "@/strava/run-backfill";

// Backfill runs after the response. 60s covers 1 Strava page + ~200 DB writes.
export const maxDuration = 60;

function errorJson(code: StravaBackfillRetryErrorCode, status: number) {
  return NextResponse.json({ error: code }, { status });
}

function rejectCrossOrigin(request: Request): NextResponse | null {
  const sfs = request.headers.get("sec-fetch-site");
  if (sfs && sfs !== "same-origin" && sfs !== "none") {
    return errorJson("unauthorized", 403);
  }
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const csrfReject = rejectCrossOrigin(request);
  if (csrfReject) return csrfReject;

  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) return errorJson("unauthorized", 401);

  const admin = createAdminClient();

  // Verify a Strava token row exists before starting a run that would
  // immediately fail with needs_reauth.
  // service-role: explicit user filter required
  const { data: token } = await admin
    .from("strava_tokens")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!token) return errorJson("no_strava_connection", 422);

  // TOCTOU-safe: UPDATE only matches when state='failed'. Two concurrent
  // Retry taps can't both win — the loser sees rowcount=0.
  const newStatus = { provider: "strava" as const, state: "queued" as const };
  // service-role: explicit user filter required
  const { data: updated, error: updateErr } = await admin
    .from("athlete_profiles")
    .update({ backfill_status: newStatus })
    .eq("user_id", user.id)
    .filter("backfill_status->>state", "eq", "failed")
    .select("backfill_status");

  if (updateErr) {
    console.error(
      "[strava.backfill.retry] db_error",
      JSON.stringify({ user_id: user.id })
    );
    return errorJson("internal_error", 500);
  }

  if (!updated || updated.length === 0) {
    // service-role: explicit user filter required
    const { data: cur } = await admin
      .from("athlete_profiles")
      .select("backfill_status")
      .eq("user_id", user.id)
      .maybeSingle();
    const current = BackfillStatusColumnSchema.parse(cur?.backfill_status ?? {});
    if (current.state === "needs_reauth") return errorJson("needs_reconnect", 422);
    if (current.state === "queued" || current.state === "in_progress") {
      return errorJson("already_in_progress", 409);
    }
    return errorJson("internal_error", 500);
  }

  // Start the backfill after the 202 is delivered.
  after(() => runBackfillForUser(user.id));

  return NextResponse.json(
    {
      status: "queued",
      backfill_status: BackfillStatusColumnSchema.parse(
        updated[0].backfill_status
      ),
    },
    { status: 202 }
  );
}
