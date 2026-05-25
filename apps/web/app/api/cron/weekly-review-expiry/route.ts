// GET /api/cron/weekly-review-expiry
//
// Vercel cron job (hourly). Marks proposed weekly_reviews whose
// earliest_affected_date has passed as 'expired'. Mirror of the Inngest
// weekly-review-expiry-sweeper -- whichever cron mechanism is wired runs the
// same idempotent sweep. See the plan, Unit 7.
//
// Vercel calls this with the CRON_SECRET in the Authorization header; without
// it the route returns 401.

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
