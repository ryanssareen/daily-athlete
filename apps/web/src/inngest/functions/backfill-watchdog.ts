// Scheduled watchdog: demotes stuck backfill runs.
//
// Fires every 15 minutes. Any athlete_profiles row with
// backfill_status.state = 'in_progress' and started_at older than 10 minutes
// is presumed dead (Inngest function timed out or was killed) and demoted to
// 'failed' with error_code 'watchdog_demoted'. The mobile Retry CTA then
// becomes available.

import { createAdminClient } from "@/db/admin";
import { inngest } from "@/inngest/client";
import { updateBackfillStatus } from "@/db/backfill-status";

const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export const backfillWatchdog = inngest.createFunction(
  {
    id: "strava-backfill-watchdog",
    name: "Strava backfill watchdog",
  },
  { cron: "*/15 * * * *" },
  async ({ step, logger }) => {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();

    const stuck = await step.run("find-stuck", async () => {
      // service-role: cross-user query is the watchdog's explicit purpose
      const { data } = await admin
        .from("athlete_profiles")
        .select("user_id, backfill_status")
        .filter("backfill_status->>state", "eq", "in_progress")
        .lt("backfill_status->>started_at", cutoff);
      return (data ?? []) as Array<{ user_id: string }>;
    });

    for (const row of stuck) {
      await step.run(`demote-${row.user_id}`, async () => {
        await updateBackfillStatus(admin, row.user_id, {
          provider: "strava",
          state: "failed",
          error_code: "watchdog_demoted",
        });
        logger.warn("[strava.backfill] watchdog_demoted", {
          user_id: row.user_id,
        });
      });
    }
  }
);
