// Inngest function: strava/backfill.start
//
// Paginates the user's last 200 Strava activities on first connect,
// normalizes + persists to completed_workouts + strava_raw_payloads, and
// tracks progress in athlete_profiles.backfill_status.
//
// Security invariants (AGENTS.md):
// - step.run() returns COUNT ONLY — no PII in Inngest Cloud step state.
// - classifyError() never echoes err.message — only closed enum codes.
// - INNGEST_SIGNING_KEY required in production (config.ts requireProd).

import { NonRetriableError, RetryAfterError } from "inngest";
import { z } from "zod";

import { createAdminClient } from "@/db/admin";
import { updateBackfillStatus } from "@/db/backfill-status";
import { inngest } from "@/inngest/client";
import { StravaActivitySchema } from "@/strava/schemas";
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

const MAX_ACTIVITIES = 200;
const PER_PAGE = 200; // Strava max; 1 request covers the whole backfill

export const backfillStravaFn = inngest.createFunction(
  {
    id: "strava-backfill",
    name: "Strava backfill on first connect",
    retries: 4,
    concurrency: [
      { limit: 50 },
      { scope: "fn", key: "event.data.user_id", limit: 1 },
    ],
    idempotency: "event.data.user_id",
    onFailure: async ({ event, error, step, logger }) => {
      const userId = z
        .string()
        .uuid()
        .parse(event.data.event.data.user_id);
      const admin = createAdminClient();
      const isNonRetriable = error.name === "NonRetriableError";
      const code = classifyError(isNonRetriable ? error.cause : error);
      const finalState =
        code === "needs_reauth" ? "needs_reauth" : "failed";
      const errorCode =
        code === "needs_reauth" ? "needs_reauth"
        : code === "key_rotation" ? "key_rotation"
        : "max_retries_exhausted";
      await step.run("mark-terminal", () =>
        updateBackfillStatus(admin, userId, {
          provider: "strava",
          state: finalState,
          error_code: errorCode,
        })
      );
      logger.error(`[strava.backfill] backfill_${finalState}`, {
        user_id: userId,
        error_code: errorCode,
      });
    },
  },
  { event: "strava/backfill.start" },
  async ({ event, step, logger }) => {
    const { user_id } = event.data as { user_id: string };
    const admin = createAdminClient();

    if (!(await userExists(admin, user_id))) {
      logger.warn("[strava.backfill] backfill_aborted_user_deleted", {
        user_id,
      });
      return;
    }

    await step.run("mark-in-progress", async () => {
      await markBackfillInProgress(admin, user_id);
      logger.info("[strava.backfill] backfill_started", { user_id });
    });

    try {
      const client = createStravaClient(user_id, admin);
      let page = 1;
      let totalImported = 0;

      while (totalImported < MAX_ACTIVITIES) {
        // Combined fetch+persist+progress step. Returns COUNT ONLY —
        // no PII in Inngest Cloud step state (step returns are stored
        // unencrypted in Inngest's database).
        const result = await step.run(`process-page-${page}`, async () => {
          const res = await client.fetch(
            `/athlete/activities?per_page=${PER_PAGE}&page=${page}`
          );
          if (res.status === 429) {
            const delayMs = computeRateLimitBackoffMs(res);
            throw new RetryAfterError("strava_rate_limited", delayMs);
          }
          if (!res.ok) {
            throw new Error(`strava_http_${res.status}`);
          }
          const activities = z
            .array(StravaActivitySchema)
            .parse(await res.json());
          const inserted = await processActivityPage({
            admin,
            userId: user_id,
            activities,
            cap: MAX_ACTIVITIES - totalImported,
          });
          await updateBackfillStatus(admin, user_id, {
            provider: "strava",
            state: "in_progress",
            completed: totalImported + inserted,
            estimated_total: MAX_ACTIVITIES,
          });
          return { inserted, hasMore: activities.length === PER_PAGE };
        });

        totalImported += result.inserted;
        if (!result.hasMore || result.inserted === 0) break;
        page += 1;
      }

      await step.run("mark-complete", async () => {
        await markBackfillComplete({
          admin,
          client,
          userId: user_id,
          total: totalImported,
        });
        logger.info("[strava.backfill] backfill_complete", {
          user_id,
          total: totalImported,
        });
      });
    } catch (err) {
      if (err instanceof StravaReauthRequired) {
        throw new NonRetriableError("strava_reauth_required", { cause: err });
      }
      if (err instanceof StravaKeyRotationError) {
        throw new NonRetriableError("strava_key_rotation", { cause: err });
      }
      if (err instanceof StravaRateLimited) {
        throw new RetryAfterError(
          "strava_rate_limited",
          computeRateLimitBackoffMs(null)
        );
      }
      // Redact error message before re-throw — Inngest history must never
      // store raw err.message (could contain PostgREST hints or tokens).
      const code = classifyError(err);
      logger.error("[strava.backfill] backfill_attempt_failed", {
        user_id,
        error_code: code,
      });
      throw new Error(code);
    }
  }
);
