// POST /api/integrations/strava/backfill/retry
//
// Re-enqueues a strava/backfill.start event for an athlete whose backfill
// previously landed in 'failed' state. Only valid when state === 'failed';
// returns 409 if queued/in_progress, 422 if needs_reauth or no token.
//
// Security posture:
// - Bearer-token auth (resolveAuth) accepts both mobile JWT and SSR cookie.
// - CSRF guard: rejects Sec-Fetch-Site: cross-site without Origin confusion.
// - TOCTOU-safe: conditional UPDATE (state='failed') is the mutex so two
//   concurrent Retry taps can't both enqueue.
// - service-role writes carry explicit user filter comments per AGENTS.md.
//
// Logging: logs user_id + error_class only. Never logs tokens, backfill
// payloads, or raw Strava error bodies.

import { NextResponse } from "next/server";

import {
  BackfillStatusColumnSchema,
  type StravaBackfillRetryErrorCode,
} from "@da2/shared";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { inngest } from "@/inngest/client";

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

  // Verify a Strava token row exists before enqueue; prevents a backfill
  // that would immediately fail with needs_reauth.
  // service-role: explicit user filter required
  const { data: token } = await admin
    .from("strava_tokens")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!token) return errorJson("no_strava_connection", 422);

  // TOCTOU-safe: UPDATE only matches when state='failed'. Two concurrent
  // Retry taps can't both win — the second sees rowcount=0.
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
      JSON.stringify({
        user_id: user.id,
        error_class: (updateErr as { constructor?: { name?: string } })?.constructor?.name ?? "unknown",
      })
    );
    return errorJson("internal_error", 500);
  }

  if (!updated || updated.length === 0) {
    // Determine why: read current state to return the right error code
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

  try {
    await inngest.send({
      name: "strava/backfill.start",
      data: { user_id: user.id },
    });
  } catch (err) {
    // Enqueue failed — revert to 'failed' so the user can tap Retry again
    // service-role: explicit user filter required
    await admin
      .from("athlete_profiles")
      .update({
        backfill_status: {
          provider: "strava",
          state: "failed",
          error_code: "enqueue_failed",
        },
      })
      .eq("user_id", user.id);
    console.error(
      "[strava.backfill.retry] enqueue_failed",
      JSON.stringify({
        user_id: user.id,
        error_class: (err as { constructor?: { name?: string } })?.constructor?.name ?? "unknown",
      })
    );
    return errorJson("enqueue_failed", 502);
  }

  // Return the new snapshot so mobile doesn't need a poll cycle to see the
  // state transition.
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
