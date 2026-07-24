// GET /api/cron/strava-reconcile
//
// Vercel cron (every 6 hours). The polling fallback for Strava auto-sync: it
// re-pulls each connected athlete's recent activities and inserts any the
// real-time webhook missed (issue #97 — there was previously NO recovery path,
// so a dropped webhook event was lost until a manual backfill re-run).
//
// It also runs a one-shot subscription health probe and warn-logs any
// split-brain between STRAVA_WEBHOOK_SUBSCRIPTION_ID and the live Strava
// subscription, so a webhook misconfiguration surfaces immediately.
//
// Vercel calls this with CRON_SECRET in the Authorization header; without it
// the route 401s to prevent public triggers. Both the health probe and each
// per-user reconcile fail soft — one bad token or a probe error never aborts
// the sweep, and the response always reports what actually happened.

import { NextResponse } from "next/server";

import { createAdminClient } from "@/db/admin";
import { reconcileAllStravaUsers } from "@/strava/reconcile";
import { checkStravaSubscriptionHealth } from "@/strava/subscription-health";

// Allow the sweep to use most of Vercel's function budget; the sweep itself
// stops ~10s early and reports any users it couldn't reach as `skipped`.
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Health probe first — never allowed to abort the sweep.
  const health = await checkStravaSubscriptionHealth();
  if (!health.ok) {
    console.warn(
      "[strava.reconcile] subscription_unhealthy",
      JSON.stringify({
        status: health.status,
        configured_id: health.configuredId ?? null,
        live_id: health.liveId,
      })
    );
  }

  const admin = createAdminClient();

  let sweep;
  try {
    sweep = await reconcileAllStravaUsers(admin, { nowMs: Date.now() });
  } catch (err) {
    console.error(
      "[strava.reconcile] sweep_failed",
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
    );
    return NextResponse.json(
      { error: "sweep_failed", health: health.status },
      { status: 500 }
    );
  }

  console.info(
    "[strava.reconcile] sweep_complete",
    JSON.stringify({
      health: health.status,
      processed: sweep.processed,
      recovered: sweep.recovered,
      failed: sweep.failed,
      skipped: sweep.skipped,
    })
  );

  return NextResponse.json({
    health: health.status,
    processed: sweep.processed,
    recovered: sweep.recovered,
    failed: sweep.failed,
    skipped: sweep.skipped,
  });
}
