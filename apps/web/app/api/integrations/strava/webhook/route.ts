// GET  /api/integrations/strava/webhook — hub challenge verification
// POST /api/integrations/strava/webhook — real-time activity event delivery
//
// Security model:
// - Strava does NOT sign webhook POST bodies (confirmed 2026). No HMAC check.
// - GET: validates hub.verify_token == config.strava.webhookVerifyToken.
// - POST: validates subscription_id matches config.strava.webhookSubscriptionId.
//   STRAVA_WEBHOOK_SUBSCRIPTION_ID must be in config with requireProd validation;
//   Number(undefined) = NaN makes the check a permanent silent no-op without it.
// - object_type='athlete' deauth events are handled explicitly before any
//   activity hydration to prevent on-demand token lookups from forged events.
// - All after() work is wrapped in classifyError(); err.message is never logged.
//
// Rate limiting via Vercel DDoS protection (documented conscious decision).
// Subscription IDs are sequential but the synchronous path is near-zero-cost.
//
// Ops: after deploying, register the subscription via:
//   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
//     -F client_id=<STRAVA_CLIENT_ID> \
//     -F client_secret=<STRAVA_CLIENT_SECRET> \
//     -F callback_url=https://<your-domain>/api/integrations/strava/webhook \
//     -F verify_token=<STRAVA_WEBHOOK_VERIFY_TOKEN>

import { after, NextResponse } from "next/server";
import { z } from "zod";

import { config } from "@/config";
import { createAdminClient } from "@/db/admin";
import { insertOrUpdateStravaCompletedWorkout } from "@/db/completed-workouts";
import { matchStravaToPlanned } from "@/strava/auto-match";
import { buildSummaryStats } from "@/strava/build-summary-stats";
import { createStravaClient } from "@/strava/client";
import { classifyError } from "@/strava/errors";
import { normalizeSport } from "@/strava/sport-normalization";
import { StravaActivitySchema } from "@/strava/schemas";

// Vercel: allow after() to run up to 60s past the response.
export const maxDuration = 60;

const WebhookEventSchema = z.object({
  object_type: z.string(),
  object_id: z.number().int().positive(),
  aspect_type: z.string(),
  owner_id: z.number().int().positive(),
  subscription_id: z.number().int(),
  event_time: z.number(),
  updates: z.record(z.unknown()).default({}),
});

// ---------------------------------------------------------------------------
// GET: hub challenge
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const challenge = url.searchParams.get("hub.challenge");
  const verifyToken = url.searchParams.get("hub.verify_token");

  if (
    mode !== "subscribe" ||
    !challenge ||
    verifyToken !== config.strava.webhookVerifyToken
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({ "hub.challenge": challenge });
}

// ---------------------------------------------------------------------------
// POST: event delivery
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<NextResponse> {
  // Parse body — silent 200 on any parse failure (don't reveal errors to callers)
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const parsed = WebhookEventSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ ok: true });
  }

  const { object_type, object_id, aspect_type, owner_id, subscription_id } = parsed.data;

  // Subscription ID gate. Any event whose subscription_id doesn't match our
  // registered subscription is dropped. Both drop paths log a warning: a
  // silent drop here previously turned a missing/rotated
  // STRAVA_WEBHOOK_SUBSCRIPTION_ID into an INVISIBLE, multi-week auto-sync
  // outage (issue #97) — the config warning fired at boot, but nothing tied
  // it to actual dropped events. subscription_id is a non-secret integer.
  const expectedSubId = config.strava.webhookSubscriptionId;
  if (expectedSubId === undefined) {
    // Misconfiguration, not a hostile event: the env var is unset, so EVERY
    // event is being dropped and no activity can auto-sync. Loud on purpose.
    console.warn(
      "[strava.webhook] dropped_event_no_subscription_id_configured",
      JSON.stringify({ subscription_id, object_type, aspect_type })
    );
    return NextResponse.json({ ok: true });
  }
  if (subscription_id !== expectedSubId) {
    console.warn(
      "[strava.webhook] dropped_event_subscription_id_mismatch",
      JSON.stringify({
        received: subscription_id,
        expected: expectedSubId,
        object_type,
        aspect_type,
      })
    );
    return NextResponse.json({ ok: true });
  }

  // Deauth event: athlete has revoked our access. Hard-delete the token row
  // so future API calls don't attempt to use invalid credentials.
  // Handled synchronously (not in after()) to prevent forged deauth events
  // from queuing on-demand service-role token lookups.
  if (object_type === "athlete") {
    const admin = createAdminClient();
    // service-role: explicit user filter required
    await admin
      .from("strava_tokens")
      .delete()
      .eq("athlete_strava_id", owner_id);
    return NextResponse.json({ ok: true });
  }

  // Metadata-only changes — no completion data to process
  if (aspect_type === "update") {
    return NextResponse.json({ ok: true });
  }

  // Return 200 immediately; heavy work deferred to after()
  after(async () => {
    const admin = createAdminClient();
    try {
      // Resolve Strava athlete ID → internal user ID
      // service-role: explicit user filter required
      const { data: tokenRow } = await admin
        .from("strava_tokens")
        .select("user_id")
        .eq("athlete_strava_id", owner_id)
        .maybeSingle();

      if (!tokenRow) {
        // Expected when an athlete has disconnected Strava before the event arrives
        console.info(
          "[strava.webhook] owner_not_found",
          JSON.stringify({ athlete_strava_id: owner_id })
        );
        return;
      }

      const userId = tokenRow.user_id as string;

      if (aspect_type === "create") {
        await handleCreate(admin, userId, object_id);
      } else if (aspect_type === "delete") {
        await handleDelete(admin, userId, object_id);
      }
    } catch (err) {
      const errorCode = classifyError(err);
      console.info(
        "[strava.webhook] after_error",
        JSON.stringify({
          athlete_strava_id: owner_id,
          strava_activity_id: object_id,
          aspect_type,
          error_code: errorCode,
        })
      );
    }
  });

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// handleCreate: fetch activity, upsert completion, match to plan
// ---------------------------------------------------------------------------

async function handleCreate(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  activityId: number
): Promise<void> {
  const stravaClient = createStravaClient(userId, admin);

  // If this fetch throws (StravaReauthRequired, StravaRateLimited, a network
  // error, or a 403 from an Inactive Strava app), the event is LOST: there is
  // no retry and no cron that re-pulls missed activities — the caller's
  // after() block only logs `after_error`. Recovering missed activities
  // requires a manual backfill re-run. See issue #97 (reconcile-cron follow-up).
  const res = await stravaClient.fetch(`/activities/${activityId}`);

  if (!res.ok) {
    throw new Error(`Strava /activities/${activityId} returned ${res.status}`);
  }

  const raw = await res.json();
  const activity = StravaActivitySchema.parse(raw);

  const sport = normalizeSport(activity.sport_type);
  const durationS = activity.moving_time ?? activity.elapsed_time ?? null;

  const row = {
    athlete_id: userId,
    source: "strava" as const,
    strava_activity_id: activity.id,
    started_at: activity.start_date,
    sport,
    distance_m: activity.distance != null ? Math.round(activity.distance) : null,
    duration_s: durationS,
    summary_stats: buildSummaryStats(activity),
  };

  const completedWorkoutId = await insertOrUpdateStravaCompletedWorkout(admin, row);

  // Non-fatal: a match failure must not abort the event handler
  try {
    await matchStravaToPlanned(admin, {
      athleteId: userId,
      completedWorkoutId,
      sport,
      startedAt: activity.start_date,
      durationS,
    });
  } catch {
    // Structured context only — never log raw activity data
    console.info(
      "[strava.webhook] match_failed",
      JSON.stringify({ athlete_id: userId, strava_activity_id: activityId })
    );
  }
}

// ---------------------------------------------------------------------------
// handleDelete: soft-delete completion + match + revert planned status
// ---------------------------------------------------------------------------

async function handleDelete(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  activityId: number
): Promise<void> {
  const now = new Date().toISOString();

  // Step 1: soft-delete the completed_workouts row
  // service-role: explicit user filter required
  const { data: deletedRows } = await admin
    .from("completed_workouts")
    .update({ deleted_at: now })
    .eq("athlete_id", userId)
    .eq("strava_activity_id", activityId)
    .is("deleted_at", null)
    .select("id");

  if (!deletedRows || deletedRows.length === 0) return;

  const completedWorkoutId = (deletedRows[0] as { id: string }).id;

  // Step 2: soft-delete linked workout_matches rows and collect planned_workout_ids
  // service-role: explicit user filter required
  const { data: deletedMatches } = await admin
    .from("workout_matches")
    .update({ deleted_at: now })
    .eq("completed_workout_id", completedWorkoutId)
    .is("deleted_at", null)
    .select("planned_workout_id");

  if (!deletedMatches || deletedMatches.length === 0) return;

  // Step 3: for each affected planned_workout, revert status to 'planned'
  // if no other live match remains
  for (const match of deletedMatches as { planned_workout_id: string }[]) {
    const { data: liveMatches } = await admin
      .from("workout_matches")
      .select("id")
      .eq("planned_workout_id", match.planned_workout_id)
      .is("deleted_at", null)
      .limit(1);

    if (!liveMatches || liveMatches.length === 0) {
      // service-role: explicit user filter required
      await admin
        .from("planned_workouts")
        .update({ status: "planned", edited_at: now })
        .eq("id", match.planned_workout_id)
        .eq("status", "completed");
    }
  }
}
