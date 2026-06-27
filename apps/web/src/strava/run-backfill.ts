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
  processActivityPage,
  userExists,
} from "@/strava/backfill-helpers";
import { StravaActivitySchema } from "@/strava/schemas";
import { z } from "zod";

const MAX_ACTIVITIES = 200;
const PER_PAGE = 200;

// Soft deadline measured from the start of the run. The connect/retry routes
// declare `maxDuration = 60`, so Vercel hard-kills the function at 60s with
// NO chance to run the catch block or write a terminal state — which is
// exactly how a run ends up frozen at `in_progress / completed: 0` until the
// 15-minute watchdog notices. We stop ~10s early and write our OWN terminal
// state so the UI gets a real, actionable result inside the same session.
const SOFT_DEADLINE_MS = 50_000;

// Keep `error_detail` comfortably under the column's 500-char bound.
const MAX_ERROR_DETAIL = 480;

function shorten(message: string): string {
  return message.length > MAX_ERROR_DETAIL
    ? `${message.slice(0, MAX_ERROR_DETAIL - 1)}…`
    : message;
}

/**
 * Run the Strava history backfill synchronously for a single user.
 * Designed to be called via Next.js `after()` so it runs after the
 * HTTP response is sent — the connect/retry routes return 202 immediately
 * and this runs in the background within Vercel's function timeout.
 *
 * Progress is written to athlete_profiles.backfill_status after every batch
 * so the onboarding/mobile poller shows the bar advancing rather than a
 * frozen 0. On any failure we persist BOTH the closed `error_code` (for
 * branching) AND a real `error_detail` (the actual error message) so the UI
 * can show what genuinely went wrong instead of a generic template.
 */
export async function runBackfillForUser(userId: string): Promise<void> {
  const admin = createAdminClient();
  const startedAtIso = new Date().toISOString();
  const startedAtMs = Date.now();
  const deadlineExceeded = (): boolean =>
    Date.now() - startedAtMs > SOFT_DEADLINE_MS;

  if (!(await userExists(admin, userId))) {
    console.info(
      "[strava.backfill] backfill_aborted_user_deleted",
      JSON.stringify({ user_id: userId })
    );
    return;
  }

  // Initial in_progress marker. We write started_at on every in_progress
  // update below too so the watchdog's `started_at < cutoff` filter keeps
  // working as a last-resort backstop.
  await updateBackfillStatus(admin, userId, {
    provider: "strava",
    state: "in_progress",
    started_at: startedAtIso,
    completed: 0,
    estimated_total: MAX_ACTIVITIES,
  });
  console.info(
    "[strava.backfill] backfill_started",
    JSON.stringify({ user_id: userId })
  );

  let totalImported = 0;

  try {
    const client = createStravaClient(userId, admin);
    let page = 1;
    let timedOut = false;

    while (totalImported < MAX_ACTIVITIES) {
      if (deadlineExceeded()) {
        timedOut = true;
        break;
      }

      const res = await client.fetch(
        `/athlete/activities?per_page=${PER_PAGE}&page=${page}`
      );

      if (res.status === 429) {
        // Can't wait and retry in a serverless function — surface as failed
        // so the Retry CTA appears. The rate limit resets in ≤15 min.
        const waitMs = computeRateLimitBackoffMs(res);
        await updateBackfillStatus(admin, userId, {
          provider: "strava",
          state: "failed",
          error_code: "rate_limited",
          completed: totalImported,
          error_detail: `Strava rate limit hit; resets in ~${Math.round(
            waitMs / 60000
          )} min. Tap Retry after that.`,
        });
        console.warn(
          "[strava.backfill] backfill_rate_limited",
          JSON.stringify({ user_id: userId, retry_in_ms: waitMs })
        );
        return;
      }

      if (!res.ok) {
        // Carry the real status into the message so it lands in error_detail.
        throw new Error(`strava_http_${res.status}`);
      }

      const activities = z.array(StravaActivitySchema).parse(await res.json());

      const inserted = await processActivityPage({
        admin,
        userId,
        activities,
        cap: MAX_ACTIVITIES - totalImported,
        shouldStop: deadlineExceeded,
        onProgress: async (processedInPage) => {
          // Durable, advancing progress — the difference between "0 forever"
          // and a bar the user watches fill.
          await updateBackfillStatus(admin, userId, {
            provider: "strava",
            state: "in_progress",
            started_at: startedAtIso,
            completed: totalImported + processedInPage,
            estimated_total: MAX_ACTIVITIES,
          });
        },
      });

      totalImported += inserted;

      // processActivityPage bails out between batches when the deadline is
      // hit, so this also catches a run that stopped mid-page.
      if (deadlineExceeded()) {
        timedOut = true;
        break;
      }

      if (activities.length < PER_PAGE || inserted === 0) break;
      page += 1;
    }

    if (timedOut && totalImported < MAX_ACTIVITIES) {
      await updateBackfillStatus(admin, userId, {
        provider: "strava",
        state: "failed",
        error_code: "timed_out",
        completed: totalImported,
        error_detail: `Imported ${totalImported} workouts before the import time budget ran out. Tap Retry to pull the rest.`,
      });
      console.warn(
        "[strava.backfill] backfill_timed_out",
        JSON.stringify({ user_id: userId, completed: totalImported })
      );
      return;
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
    // The REAL message from the error we actually caught — not a guess.
    const errorDetail = shorten(
      err instanceof Error ? err.message : String(err)
    );

    await updateBackfillStatus(admin, userId, {
      provider: "strava",
      state,
      error_code: errorCode,
      completed: totalImported,
      error_detail: errorDetail,
    }).catch((writeErr) => {
      // Best-effort: if this write fails, backfill_status stays in_progress
      // and the watchdog cron will demote it to failed within 15 min.
      console.error(
        "[strava.backfill] status_write_failed_after_error",
        JSON.stringify({
          user_id: userId,
          detail:
            writeErr instanceof Error ? writeErr.message : String(writeErr),
        })
      );
    });

    console.error(
      `[strava.backfill] backfill_${state}`,
      JSON.stringify({
        user_id: userId,
        error_code: errorCode,
        error_name: err instanceof Error ? err.name : typeof err,
        error_detail: errorDetail,
      })
    );
  }
}
