import "server-only";

import { createAdminClient } from "@/db/admin";
import { updateBackfillStatus } from "@/db/backfill-status";
import { createStravaClient } from "@/strava/client";
import {
  StravaKeyRotationError,
  StravaRateLimited,
  StravaReauthRequired,
  classifyError,
} from "@/strava/errors";
import {
  computeRateLimitBackoffMs,
  markBackfillComplete,
  markBackfillInProgress,
  processActivityPage,
  userExists,
} from "@/strava/backfill-helpers";
import { StravaActivitySchema } from "@/strava/schemas";
import { z } from "zod";

const MAX_ACTIVITIES = 200;
const PER_PAGE = 200;

/**
 * Run the Strava history backfill synchronously for a single user.
 * Designed to be called via Next.js `after()` so it runs after the
 * HTTP response is sent — the connect/retry routes return 202 immediately
 * and this runs in the background within Vercel's function timeout.
 *
 * Progress is written to athlete_profiles.backfill_status so the mobile
 * polling hook can show live state.
 */
export async function runBackfillForUser(userId: string): Promise<void> {
  const admin = createAdminClient();

  if (!(await userExists(admin, userId))) {
    console.info(
      "[strava.backfill] backfill_aborted_user_deleted",
      JSON.stringify({ user_id: userId })
    );
    return;
  }

  await markBackfillInProgress(admin, userId);
  console.info(
    "[strava.backfill] backfill_started",
    JSON.stringify({ user_id: userId })
  );

  try {
    const client = createStravaClient(userId, admin);
    let page = 1;
    let totalImported = 0;

    while (totalImported < MAX_ACTIVITIES) {
      const res = await client.fetch(
        `/athlete/activities?per_page=${PER_PAGE}&page=${page}`
      );

      if (res.status === 429) {
        // Can't wait and retry in a serverless function — surface as failed
        // so the mobile Retry CTA appears. The rate limit resets in ≤15 min.
        const waitMs = computeRateLimitBackoffMs(res);
        await updateBackfillStatus(admin, userId, {
          provider: "strava",
          state: "failed",
          error_code: "rate_limited",
          completed: totalImported,
        });
        console.warn(
          "[strava.backfill] backfill_rate_limited",
          JSON.stringify({ user_id: userId, retry_in_ms: waitMs })
        );
        return;
      }

      if (!res.ok) {
        throw new Error(`strava_http_${res.status}`);
      }

      const activities = z.array(StravaActivitySchema).parse(await res.json());

      const inserted = await processActivityPage({
        admin,
        userId,
        activities,
        cap: MAX_ACTIVITIES - totalImported,
      });

      totalImported += inserted;

      await updateBackfillStatus(admin, userId, {
        provider: "strava",
        state: "in_progress",
        completed: totalImported,
        estimated_total: MAX_ACTIVITIES,
      });

      if (activities.length < PER_PAGE || inserted === 0) break;
      page += 1;
    }

    await markBackfillComplete({
      admin,
      client,
      userId,
      total: totalImported,
    });
    console.info(
      "[strava.backfill] backfill_complete",
      JSON.stringify({ user_id: userId, total: totalImported })
    );
  } catch (err) {
    const state =
      err instanceof StravaReauthRequired ? "needs_reauth" : "failed";
    const errorCode =
      err instanceof StravaReauthRequired
        ? "needs_reauth"
        : err instanceof StravaKeyRotationError
          ? "key_rotation"
          : err instanceof StravaRateLimited
            ? "rate_limited"
            : classifyError(err);

    await updateBackfillStatus(admin, userId, {
      provider: "strava",
      state,
      error_code: errorCode,
    }).catch(() => {
      // Best-effort: if this write fails, backfill_status stays in_progress
      // and the watchdog cron will demote it to failed within 15 min.
    });

    console.error(
      `[strava.backfill] backfill_${state}`,
      JSON.stringify({ user_id: userId, error_code: errorCode })
    );
  }
}
