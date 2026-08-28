// POST /api/admin/backfill-matches — retroactively run matchStravaToPlanned
// over existing Strava completed_workouts that have no live workout_matches
// row.
//
// Why this is needed: matching normally happens once, at ingest time (the
// Strava webhook, or the historical backfill sync). A timezone bug in
// matchStravaToPlanned (fixed in de81da9) resolved the completed workout's
// calendar day in UTC instead of the athlete's own timezone, so any activity
// near either end of the athlete's local day silently failed to match —
// "no planned workout that day" was indistinguishable from "the match logic
// got the day wrong." Those workouts are still unmatched in production;
// re-running the (now-fixed) matcher against them is a one-time reconciliation,
// not a recurring job — the webhook and backfill paths keep newly-synced
// activities matched correctly going forward.
//
// Safe to run more than once: matchStravaToPlanned is idempotent per
// completed_workout (it no-ops once a live match exists), so a partial run
// (e.g. hitting the batch limit) can simply be re-invoked to pick up where it
// left off.

import { NextResponse } from "next/server";

import { requireAdmin } from "@/auth/admin-guard";
import { clientIp, isSameOriginRequest } from "@/auth/admin-session";
import { createAdminClient } from "@/db/admin";
import { writeAudit } from "@/db/admin-audit";
import { matchStravaToPlanned } from "@/strava/auto-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bounds one invocation's work so it can't run past the function timeout;
// callers re-POST to continue (matchStravaToPlanned's idempotency guard
// makes that safe).
const BATCH_LIMIT = 200;

interface CandidateRow {
  id: string;
  athlete_id: string;
  sport: string;
  started_at: string;
  duration_s: number | null;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(request.headers)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  const admin = createAdminClient();

  // Live (non-superseded) matches, so we know which completed_workouts to skip.
  // service-role: no user filter — this reconciliation is intentionally global,
  // read-only until the per-row match call below (which itself filters by
  // athlete_id).
  const { data: liveMatches, error: matchesErr } = await admin
    .from("workout_matches")
    .select("completed_workout_id")
    .is("deleted_at", null);

  if (matchesErr) {
    return NextResponse.json({ error: "matches_query_failed" }, { status: 500 });
  }

  const matchedIds = new Set((liveMatches ?? []).map((m) => m.completed_workout_id as string));

  // service-role: global reconciliation scan, filtered to Strava-sourced rows
  // only (manual/other-source rows never go through matchStravaToPlanned).
  const { data: candidates, error: candidatesErr } = await admin
    .from("completed_workouts")
    .select("id, athlete_id, sport, started_at, duration_s")
    .eq("source", "strava")
    .is("deleted_at", null)
    .is("superseded_by_id", null)
    .order("started_at", { ascending: true })
    .limit(2000); // upper bound on the scan itself; BATCH_LIMIT bounds work done

  if (candidatesErr) {
    return NextResponse.json({ error: "candidates_query_failed" }, { status: 500 });
  }

  const unmatched = ((candidates ?? []) as CandidateRow[]).filter(
    (c) => !matchedIds.has(c.id)
  );
  const batch = unmatched.slice(0, BATCH_LIMIT);

  let matched = 0;
  let errored = 0;
  const errors: string[] = [];

  for (const cw of batch) {
    try {
      const result = await matchStravaToPlanned(admin, {
        athleteId: cw.athlete_id,
        completedWorkoutId: cw.id,
        sport: cw.sport,
        startedAt: cw.started_at,
        durationS: cw.duration_s,
      });
      if (result.matched) matched++;
    } catch (err) {
      errored++;
      if (errors.length < 10) {
        errors.push(err instanceof Error ? err.message : "unknown error");
      }
    }
  }

  const summary = {
    scanned: unmatched.length,
    processed: batch.length,
    matched,
    errored,
    remaining: Math.max(0, unmatched.length - batch.length),
  };

  await writeAudit({
    action: "admin.backfill-matches.run",
    ip: clientIp(request.headers),
    sessionId: gate.sessionId,
    metadata: summary,
  });

  return NextResponse.json({ ok: true, ...summary, errors: errors.length > 0 ? errors : undefined });
}
