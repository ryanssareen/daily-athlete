// Inngest function: weekly-review-scheduler (hourly cron)
//
// Fires every hour (UTC). Selects athletes with an active plan whose LOCAL time
// is currently Sunday ~18:00, and enqueues one per-athlete weekly-review run.
// The run function's idempotency (athlete_id + ISO-week key) makes overlapping
// ticks safe. See the plan, Unit 8.
//
// Entitlement is enforced in the run function (single source of truth); the
// scheduler enqueues all due active-plan athletes.

import type { SupabaseClient } from "@supabase/supabase-js";

import { isWeeklyReviewDue, weeklyReviewWeekKey } from "@/ai/adaptive/schedule";
import { createAdminClient } from "@/db/admin";
import { inngest } from "@/inngest/client";
import { ADAPTIVE_RUN_EVENT } from "./adaptive-run";

export interface DueAthlete {
  athlete_id: string;
  week_key: string;
}

/**
 * Find athletes with an active, non-deleted plan whose local time is currently
 * the Sunday 18:00 hour. Returns ids + ISO-week keys only (no PII).
 * Service-role cross-user sweep is this job's explicit purpose.
 */
export async function selectDueAthletes(
  admin: SupabaseClient,
  now: Date,
): Promise<DueAthlete[]> {
  // service-role: cross-user scheduling sweep is this job's explicit purpose
  const { data: plans, error: plansErr } = await admin
    .from("plans")
    .select("athlete_id")
    .eq("status", "active")
    .is("deleted_at", null);
  if (plansErr) throw plansErr;

  const athleteIds = [...new Set((plans ?? []).map((p) => p.athlete_id as string))];
  if (athleteIds.length === 0) return [];

  // service-role: explicit id-set filter
  const { data: users, error: usersErr } = await admin
    .from("users")
    .select("id, timezone")
    .in("id", athleteIds);
  if (usersErr) throw usersErr;

  const due: DueAthlete[] = [];
  for (const u of users ?? []) {
    const tz = (u.timezone as string | null) ?? "UTC";
    if (isWeeklyReviewDue(tz, now)) {
      due.push({ athlete_id: u.id as string, week_key: weeklyReviewWeekKey(tz, now) });
    }
  }
  return due;
}

export const weeklyReviewScheduler = inngest.createFunction(
  {
    id: "weekly-review-scheduler",
    name: "Weekly review scheduler",
  },
  { cron: "0 * * * *" }, // hourly; per-athlete-local Sunday 18:00 is filtered inside
  async ({ step, logger }) => {
    const admin = createAdminClient();
    const now = new Date();

    const due = await step.run("select-due", () => selectDueAthletes(admin, now));

    if (due.length > 0) {
      await step.run("enqueue", async () => {
        await inngest.send(
          due.map((d) => ({
            name: ADAPTIVE_RUN_EVENT,
            data: {
              athlete_id: d.athlete_id,
              trigger_kind: "weekly" as const,
              scope: "plan" as const,
              dedup_key: d.week_key, // stable -> one weekly run per athlete per ISO week
            },
          })),
        );
        return { enqueued: due.length };
      });
    }

    logger.info("[weekly-review] scheduled", { due: due.length });
    return { due: due.length };
  },
);
