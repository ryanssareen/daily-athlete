// Inngest function: period-review-scheduler (hourly cron)
//
// Fires every hour (UTC). Selects athletes whose LOCAL period just closed and
// who have opted into that cadence, then fans out one delivery event each.
//
// WHY INNGEST AND NOT VERCEL CRON (KTD6): the Vercel Hobby plan caps cron at 2
// daily jobs, both slots are taken (backfill-watchdog, backup-prune), and
// exceeding the cap fails config validation for the WHOLE deployment. An hourly
// schedule is also impossible there. See
// apps/web/app/api/cron/weekly-review-expiry/route.ts, which documents the same
// constraint. This mirrors weekly-review-scheduler exactly.
//
// The scheduler's filters are an OPTIMIZATION, not the guarantee. Consent is
// re-checked in the worker (single source of truth) and idempotency by the
// delivery ledger's unique index -- a stale or racing scheduler cannot cause a
// duplicate send.
//
// Payloads and logs carry IDS ONLY. No email address, no narration, nothing
// that would put athlete PII into Inngest's run history.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PeriodKind } from "@da2/shared";

import { digestPeriodKey, isDigestDue } from "@/ai/period-reviews/schedule";
import { createAdminClient } from "@/db/admin";
import { inngest } from "@/inngest/client";

import { PERIOD_REVIEW_DELIVERY_EVENT } from "./period-review-delivery";

export interface DueDigest {
  athlete_id: string;
  kind: PeriodKind;
  period_key: string;
}

interface CandidateRow {
  id: string;
  timezone: string | null;
  email_weekly_review: boolean;
  email_monthly_review: boolean;
}

/**
 * Athletes whose local period just closed and who want that cadence by email.
 *
 * The opted-in set is read first and the local-time filter applied in memory:
 * "is it 07:00 Monday for this athlete" is not expressible as a SQL predicate
 * without a per-row timezone conversion, and the opted-in population is the
 * small side of the join (both preferences default false, migration 0030).
 *
 * Returns ids and period keys only -- no PII.
 */
export async function selectDueDigests(
  admin: SupabaseClient,
  now: Date,
): Promise<DueDigest[]> {
  // service-role: cross-user scheduling sweep is this job's explicit purpose.
  // Soft-deleted accounts are excluded -- mailing a deleted account would be a
  // privacy incident, not just a wasted send.
  const { data, error } = await admin
    .from("users")
    .select("id, timezone, email_weekly_review, email_monthly_review")
    .is("deleted_at", null)
    .or("email_weekly_review.eq.true,email_monthly_review.eq.true");
  if (error) throw error;

  const due: DueDigest[] = [];
  for (const row of (data ?? []) as CandidateRow[]) {
    const tz = row.timezone ?? "UTC";

    if (row.email_weekly_review && isDigestDue("weekly", tz, now)) {
      due.push({
        athlete_id: row.id,
        kind: "weekly",
        period_key: digestPeriodKey("weekly", tz, now),
      });
    }
    if (row.email_monthly_review && isDigestDue("monthly", tz, now)) {
      due.push({
        athlete_id: row.id,
        kind: "monthly",
        period_key: digestPeriodKey("monthly", tz, now),
      });
    }
  }
  return due;
}

export const periodReviewScheduler = inngest.createFunction(
  {
    id: "period-review-scheduler",
    name: "Period review digest scheduler",
  },
  { cron: "0 * * * *" }, // hourly; per-athlete-local timing is filtered inside
  async ({ step, logger }) => {
    const admin = createAdminClient();
    const now = new Date();

    const due = await step.run("select-due", () => selectDueDigests(admin, now));

    if (due.length > 0) {
      await step.run("enqueue", async () => {
        await inngest.send(
          due.map((d) => ({
            name: PERIOD_REVIEW_DELIVERY_EVENT,
            data: {
              athlete_id: d.athlete_id,
              kind: d.kind,
              period_key: d.period_key,
            },
          })),
        );
        return { enqueued: due.length };
      });
    }

    logger.info("[period-review] scheduled", {
      due: due.length,
      weekly: due.filter((d) => d.kind === "weekly").length,
      monthly: due.filter((d) => d.kind === "monthly").length,
    });
    return { due: due.length };
  },
);
