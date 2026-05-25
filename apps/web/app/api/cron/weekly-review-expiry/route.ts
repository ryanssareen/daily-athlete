// GET /api/cron/weekly-review-expiry
//
// Marks proposed weekly_reviews whose earliest_affected_date has passed as
// 'expired'. Idempotent. CRON_SECRET-gated (401 without it).
//
// NOT scheduled in vercel.json: the Vercel Hobby plan caps cron jobs at 2 and
// daily-only frequency, and those slots are taken (backfill-watchdog,
// backup-prune). Adding a 3rd / hourly cron makes the whole deployment fail at
// config validation. The expiry sweep is scheduled on INNGEST instead
// (weekly-review-expiry-sweeper, hourly -- not counted against Vercel's limit).
// This route remains as a manual/backup trigger. If the project moves to Vercel
// Pro, an hourly cron entry can be re-added here.

import { NextResponse } from "next/server";

import { createAdminClient } from "@/db/admin";

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  // service-role: cross-user sweep is this job's explicit purpose
  const { data, error } = await admin
    .from("weekly_reviews")
    .update({ status: "expired", decided_at: new Date().toISOString() })
    .eq("status", "proposed")
    .is("deleted_at", null)
    .lt("earliest_affected_date", today)
    .select("id");

  if (error) {
    console.error("[weekly-review-expiry] query_failed", JSON.stringify({ error: error.message }));
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  return NextResponse.json({ expired: (data ?? []).length });
}
