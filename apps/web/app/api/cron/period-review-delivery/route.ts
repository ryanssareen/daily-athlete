// GET /api/cron/period-review-delivery
//
// Manual / backup trigger for the period-review digest sweep. Runs the same
// selection the Inngest scheduler runs and enqueues the same events, so it is
// safe to hit at any time: the delivery ledger's unique index (migration 0029)
// makes a duplicate enqueue a no-op rather than a duplicate send.
//
// CRON_SECRET-gated (401 without it).
//
// NOT scheduled in vercel.json, deliberately. The Vercel Hobby plan caps cron
// jobs at 2 and daily-only frequency, both slots are taken (backfill-watchdog,
// backup-prune), and adding a third makes the whole deployment fail at config
// validation. Digest delivery is scheduled on INNGEST instead
// (period-review-scheduler, hourly). This route exists for operators: replaying
// a tick that failed, or sending a digest after a deploy that missed its
// window. Same posture and same reasoning as
// apps/web/app/api/cron/weekly-review-expiry/route.ts.

import "server-only";

import { NextResponse } from "next/server";

import { selectDueDigests } from "@/inngest/functions/period-review-scheduler";
import { PERIOD_REVIEW_DELIVERY_EVENT } from "@/inngest/functions/period-review-delivery";
import { createAdminClient } from "@/db/admin";
import { inngest } from "@/inngest/client";

export async function GET(request: Request): Promise<NextResponse> {
  // Fail CLOSED on an unset secret. `authHeader !== \`Bearer ${undefined}\``
  // compares against the literal string "Bearer undefined", so an environment
  // missing CRON_SECRET would make this route publicly triggerable -- and this
  // one enqueues real email. The check is explicit rather than relying on the
  // template interpolation.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[period-review.cron] CRON_SECRET is not set; refusing");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  let due;
  try {
    due = await selectDueDigests(admin, new Date());
  } catch (err) {
    console.error("[period-review.cron] selection failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  if (due.length > 0) {
    await inngest.send(
      due.map((d) => ({
        name: PERIOD_REVIEW_DELIVERY_EVENT,
        data: { athlete_id: d.athlete_id, kind: d.kind, period_key: d.period_key },
      })),
    );
  }

  // Counts only — no ids, no addresses.
  return NextResponse.json({ enqueued: due.length });
}
