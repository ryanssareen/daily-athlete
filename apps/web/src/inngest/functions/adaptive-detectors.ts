// Inngest function: adaptive-detectors (daily cron)
//
// Fires once a day (UTC). The completion-driven detection layer of the AI
// adaptive-plans engine. For every athlete with an active, non-deleted plan it
// loads recent planned_workouts + live workout_matches, runs the pure B2
// missed-block detector (`@/ai/adaptive/detectors/missed-block`), and for
// athletes who missed a block enqueues the shared adaptive runner with
// trigger_kind='missed_block'. See the plan, Unit 9.
//
// B5 (fatigue deload) / B6 (progression bump) are DEFERRED from v1 — firing
// unprompted on a Strava-only proxy is the highest trust risk — so only B2 is
// wired here. They extend this detector additively when the load proxy is
// validated.
//
// Strava-health gate (codebase gap): there is no durable needs_reauth flag on
// strava_tokens today, so a token that silently stopped delivering completions
// could make planned workouts look "missed". We gate on
// athlete_profiles.backfill_status->>state != 'needs_reauth' as the best
// available proxy. TODO: durable strava-health signal (a strava_tokens column
// set on refresh-failure) — the plan documents this gap.
//
// Step returns carry counts only (no PII in Inngest history).

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  detectMissedBlock,
  type DetectMissedBlockResult,
  type DetectorMatch,
  type DetectorPlannedWorkout,
} from "@/ai/adaptive/detectors/missed-block";
import { createAdminClient } from "@/db/admin";
import { inngest } from "@/inngest/client";
import { ADAPTIVE_RUN_EVENT } from "./adaptive-run";

// How far back to load planned workouts when scanning for a gap. A scan window
// wider than the largest bucket ('>2w') so a multi-week gap is fully seen.
const SCAN_WINDOW_DAYS = 35;

/** A detected missed-block result for one athlete (ids/counts only — no PII). */
export interface MissedBlockHit {
  athlete_id: string;
  first_missed_date: string;
  missed_count: number;
  bucket: DetectMissedBlockResult["bucket"];
  /** Stable dedup key so repeated daily scans of the same gap don't re-trigger. */
  dedup_key: string;
}

/**
 * Run the missed-block detector for a single athlete. PURE-ISH: all DB reads go
 * through the passed-in client; returns a hit or null. Extracted (mirroring
 * Unit 8's `selectDueAthletes`) so the per-athlete scan is unit-testable with a
 * mocked admin client.
 *
 * The Strava-health gate is applied here: if the athlete's backfill_status is
 * 'needs_reauth', missing completions likely mean the integration stopped
 * delivering data, not that the athlete missed training — so we suppress.
 */
export async function scanAthleteForMissedBlock(
  admin: SupabaseClient,
  athleteId: string,
  now: Date,
): Promise<MissedBlockHit | null> {
  // service-role: explicit user filter required
  const { data: user } = await admin
    .from("users")
    .select("timezone")
    .eq("id", athleteId)
    .single();
  const timezone = (user?.timezone as string | null) ?? "UTC";

  // Strava-health gate. service-role: explicit user filter.
  // TODO: durable strava-health signal — backfill_status is a one-time enum, not
  // a live token-health flag; this is the best available proxy (plan Unit 9).
  const { data: profile } = await admin
    .from("athlete_profiles")
    .select("backfill_status")
    .eq("user_id", athleteId)
    .single();
  const backfillState =
    (profile?.backfill_status as { state?: string } | null)?.state ?? null;
  if (backfillState === "needs_reauth") return null;

  const windowStart = new Date(now.getTime() - SCAN_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Recent planned workouts. service-role: explicit user filter.
  const { data: planned } = await admin
    .from("planned_workouts")
    .select("id, scheduled_date, status")
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .gte("scheduled_date", windowStart);
  const plannedWorkouts = (planned ?? []) as DetectorPlannedWorkout[];
  if (plannedWorkouts.length === 0) return null;

  // Live matches for those workouts. service-role: explicit id-set filter.
  const plannedIds = plannedWorkouts.map((w) => w.id);
  const { data: matchRows } = await admin
    .from("workout_matches")
    .select("planned_workout_id")
    .in("planned_workout_id", plannedIds)
    .is("deleted_at", null);
  const matches = (matchRows ?? []) as DetectorMatch[];

  const result = detectMissedBlock({ plannedWorkouts, matches, timezone, now });
  if (!result.missed || !result.firstMissedDate) return null;

  return {
    athlete_id: athleteId,
    first_missed_date: result.firstMissedDate,
    missed_count: result.missedCount,
    bucket: result.bucket,
    // Stable key anchored on the gap start: repeated daily scans of the same
    // ongoing gap collapse to one enqueue (the adaptive runner's idempotency is
    // athlete_id + trigger_kind + dedup_key).
    dedup_key: `missed-${result.firstMissedDate}`,
  };
}

/**
 * List athlete ids with an active, non-deleted plan. Service-role cross-user
 * sweep is this job's explicit purpose.
 */
export async function selectActivePlanAthletes(
  admin: SupabaseClient,
): Promise<string[]> {
  // service-role: cross-user detection sweep is this job's explicit purpose
  const { data: plans, error } = await admin
    .from("plans")
    .select("athlete_id")
    .eq("status", "active")
    .is("deleted_at", null);
  if (error) throw error;
  return [...new Set((plans ?? []).map((p) => p.athlete_id as string))];
}

export const adaptiveDetectors = inngest.createFunction(
  {
    id: "adaptive-detectors",
    name: "Adaptive detectors (B2 missed-block)",
  },
  { cron: "0 6 * * *" }, // daily at 06:00 UTC
  async ({ step, logger }) => {
    const admin = createAdminClient();
    const now = new Date();

    const athleteIds = await step.run("select-active-plan-athletes", () =>
      selectActivePlanAthletes(admin),
    );

    const hits = await step.run("scan-missed-block", async () => {
      // Promise.allSettled so one athlete's read failure never sinks the sweep.
      const settled = await Promise.allSettled(
        athleteIds.map((id) => scanAthleteForMissedBlock(admin, id, now)),
      );
      const out: MissedBlockHit[] = [];
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value) out.push(r.value);
      }
      return out;
    });

    if (hits.length > 0) {
      await step.run("enqueue", async () => {
        await inngest.send(
          hits.map((h) => ({
            name: ADAPTIVE_RUN_EVENT,
            data: {
              athlete_id: h.athlete_id,
              trigger_kind: "missed_block" as const,
              scope: "plan" as const,
              dedup_key: h.dedup_key, // stable -> one run per ongoing gap
            },
          })),
        );
        return { enqueued: hits.length };
      });
    }

    logger.info("[adaptive-detectors] scan_complete", {
      scanned: athleteIds.length,
      missed: hits.length,
    });
    return { scanned: athleteIds.length, missed: hits.length };
  },
);
