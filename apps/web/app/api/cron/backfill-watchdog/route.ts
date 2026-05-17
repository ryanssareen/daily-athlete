// GET /api/cron/backfill-watchdog
//
// Vercel cron job (every 15 minutes). Demotes athlete_profiles rows that
// have been stuck in 'in_progress' for more than 10 minutes to 'failed'
// so the mobile Retry CTA surfaces instead of showing a permanent spinner.
//
// Vercel calls this with the CRON_SECRET in the Authorization header.
// Without it, the route returns 401 to prevent accidental public triggers.

import { NextResponse } from "next/server";

import { createAdminClient } from "@/db/admin";
import { updateBackfillStatus } from "@/db/backfill-status";

const STUCK_THRESHOLD_MS = 10 * 60 * 1000;

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();

  // service-role: cross-user query is the watchdog's explicit purpose
  const { data: stuck, error } = await admin
    .from("athlete_profiles")
    .select("user_id")
    .filter("backfill_status->>state", "eq", "in_progress")
    .lt("backfill_status->>started_at", cutoff);

  if (error) {
    console.error("[watchdog] query_failed", JSON.stringify({ error: error.message }));
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const rows = stuck ?? [];
  await Promise.all(
    rows.map((row) =>
      updateBackfillStatus(admin, row.user_id, {
        provider: "strava",
        state: "failed",
        error_code: "watchdog_demoted",
      }).then(() =>
        console.warn(
          "[watchdog] demoted",
          JSON.stringify({ user_id: row.user_id })
        )
      )
    )
  );

  return NextResponse.json({ demoted: rows.length });
}
