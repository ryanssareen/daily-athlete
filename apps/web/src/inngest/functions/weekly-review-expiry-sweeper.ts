// Scheduled expiry sweeper for AI adaptive proposals.
//
// Fires hourly. Any weekly_reviews row still in status='proposed' whose
// earliest_affected_date has passed is marked 'expired' -- a proposal that
// would reschedule days already in the past is useless/harmful. See
// docs/plans/2026-05-25-001-feat-ai-adaptive-plans-engine-plan.md (Unit 7).
//
// Service-role bulk sweep (a trusted system job, not a client write -- the
// "status is client-write-forbidden" rule targets athlete forgery, not system
// maintenance). Step returns carry a count only (no PII in Inngest history).

import { createAdminClient } from "@/db/admin";
import { inngest } from "@/inngest/client";

export const weeklyReviewExpirySweeper = inngest.createFunction(
  {
    id: "weekly-review-expiry-sweeper",
    name: "Weekly review expiry sweeper",
  },
  { cron: "0 * * * *" }, // hourly
  async ({ step, logger }) => {
    const admin = createAdminClient();
    // Compare against today's UTC date. Date-granularity makes per-athlete tz
    // immaterial for "the affected day has already passed".
    const today = new Date().toISOString().slice(0, 10);

    const expired = await step.run("expire-stale", async () => {
      // service-role: cross-user sweep is this job's explicit purpose
      const { data, error } = await admin
        .from("weekly_reviews")
        .update({ status: "expired", decided_at: new Date().toISOString() })
        .eq("status", "proposed")
        .is("deleted_at", null)
        .lt("earliest_affected_date", today)
        .select("id");
      if (error) throw error;
      return (data ?? []).length;
    });

    logger.info("[weekly-review] expiry_sweep", { expired });
    return { expired };
  },
);
