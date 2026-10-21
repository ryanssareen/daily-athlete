// GET /api/cron/backup-prune — Vercel cron (daily). Age-prunes export
// artifacts past retention and reconciles orphans. Authenticated with
// CRON_SECRET (same pattern as backfill-watchdog); 401 without it so it can't
// be triggered publicly.

import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/auth/cron-auth";
import { pruneBackups } from "@/admin/backup-retention";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await pruneBackups();
    return NextResponse.json(result);
  } catch (err) {
    console.error(
      "[backup-prune] failed",
      JSON.stringify({ message: err instanceof Error ? err.message : "unknown" })
    );
    return NextResponse.json({ error: "prune_failed" }, { status: 500 });
  }
}
