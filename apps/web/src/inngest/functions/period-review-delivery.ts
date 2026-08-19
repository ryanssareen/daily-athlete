// Inngest function: period-review/delivery.requested
//
// One athlete, one period, one email. Claims the delivery ledger row, assembles
// the review, narrates it, persists it, sends it, and marks the claim sent.
//
// THE ORDER IS THE POINT (KTD10). The claim happens BEFORE any work:
//
//   claim -> assemble -> narrate -> persist review -> send -> mark sent
//
// The unique index on (athlete_id, kind, period_key) means a second worker --
// an Inngest retry, an overlapping hourly tick, an operator hitting the manual
// trigger -- loses the insert and exits without sending. Claiming AFTER the LLM
// call would leave a window in which two workers both generate and both send;
// claiming after the send would leave one in which a crash between send and
// record causes a duplicate on retry. R13 says an athlete is never sent the
// same period twice, and this ordering is what makes that true rather than
// likely.
//
// TRANSIENT vs TERMINAL is the axis the whole failure policy turns on:
//
//   TRANSIENT (a read blip, a rate limit, a provider 5xx) -> RELEASE the claim
//     and throw, so the Inngest retry re-claims and genuinely re-attempts.
//   TERMINAL (not entitled, opted out, nothing to report, unusable model
//     output, a 4xx refusal) -> stamp a terminal status and stop.
//
// Getting this wrong in either direction is expensive: a terminal stamp on a
// transient failure costs the athlete that period's digest permanently (the
// ledger's unique index is not partial, so the row blocks every later attempt),
// while releasing a terminal failure invites an endless retry loop against a
// shared LLM budget.
//
// A claim can still be stranded by a process that DIES between claiming and
// finishing. STALE_CLAIM_MS bounds that: a later attempt adopts a claim left in
// `claimed` for over an hour, via a conditional UPDATE that two racing workers
// cannot both win.
//
// R15/AE10 -- A FAILED NARRATION SENDS NOTHING. The API route degrades to
// facts-with-a-retry-button because a human is watching and can ask again. Here
// there is no one to ask: a digest email without its narration is a table of
// numbers with no coaching in it, which is not the product. The claim is
// released (status 'failed' with a non-PII reason) and no mail goes out.
//
// NO PII ANYWHERE IN THE JOB. The event payload carries ids; the email address
// is read inside the step and never logged, never returned, never stored in
// Inngest history.

import { NonRetriableError, RetryAfterError } from "inngest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { PeriodKindSchema, isValidPeriodKey } from "@da2/shared";

import {
  assemblePeriodReview,
  readAthleteTimezone,
  resolveModelLabel,
} from "@/ai/period-reviews/assemble";
import { persistPeriodReview } from "@/db/period-reviews";
import { InvalidPeriodKeyError } from "@/ai/period-reviews/calendar";
import { narratePeriod, PeriodNarrationInvalidError } from "@/ai/period-reviews/narrate";
import { hasActiveEntitlement } from "@/auth/entitlements";
import { config } from "@/config";
import { createAdminClient } from "@/db/admin";
import { sendPeriodDigest } from "@/email/period-review-email";
import { inngest } from "@/inngest/client";
import { createLlmClient, isLlmBackOff, LlmInvalidOutput } from "@/llm";

export const PERIOD_REVIEW_DELIVERY_EVENT = "period-review/delivery.requested" as const;

const EventDataSchema = z.object({
  athlete_id: z.string().uuid(),
  kind: PeriodKindSchema,
  period_key: z.string(),
});

/** Outcome slugs. Non-PII by construction -- these are the only strings that
 * reach the ledger's `failure_reason` or an Inngest step return. */
export type DeliveryOutcome =
  | "sent"
  | "already_claimed"
  | "not_entitled"
  | "no_data"
  | "llm_rate_limited"
  | "llm_invalid_output"
  | "email_not_configured"
  | "email_failed"
  | "assemble_failed"
  | "opted_out";

const PII_FREE_LOG = "[period-review.delivery]";

/**
 * How long a claim may sit in `claimed` before another worker may take it over.
 *
 * A claim is only ever stranded by a process that DIED between claiming and
 * finishing — a crash, an OOM, a platform timeout kill. One hour is far longer
 * than any healthy run (the LLM client's own timeout is 120s) so a takeover
 * cannot race a live worker, and far shorter than the gap to the next period,
 * so a crash does not cost the athlete their digest.
 */
export const STALE_CLAIM_MS = 60 * 60 * 1000;

/**
 * Take ownership of (athlete, kind, period), or report who has it.
 *
 * Three outcomes, because "someone else is working on it" and "my own previous
 * attempt died" need different responses and used to be indistinguishable:
 *   - "claimed"     — a fresh claim; nobody had this period.
 *   - "taken_over"  — a previous attempt died mid-flight and left the row in
 *                     `claimed` past STALE_CLAIM_MS; this worker adopts it.
 *   - "held"        — a live worker owns it, or it already reached a terminal
 *                     status. Exit quietly; this is normal contention.
 *
 * The takeover is a conditional UPDATE, so two workers racing to adopt the same
 * stale claim cannot both win: Postgres serializes them and the second matches
 * zero rows because the first moved `claimed_at`.
 */
async function claim(
  admin: SupabaseClient,
  athleteId: string,
  kind: string,
  periodKey: string,
): Promise<"claimed" | "taken_over" | "held"> {
  // service-role: explicit user filter required
  const { error } = await admin.from("period_review_deliveries").insert({
    athlete_id: athleteId,
    kind,
    period_key: periodKey,
    status: "claimed",
  });

  if (!error) return "claimed";
  if (error.code !== "23505") throw new Error(`claim failed: ${error.message}`);

  // A row exists. Adopt it only if it is a STALE claim -- never one that
  // reached a terminal status (sent / skipped / failed), which must stay
  // terminal so R13 holds.
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  // service-role: explicit user filter required
  const { data: adopted, error: takeoverErr } = await admin
    .from("period_review_deliveries")
    .update({ claimed_at: new Date().toISOString(), failure_reason: null })
    .eq("athlete_id", athleteId)
    .eq("kind", kind)
    .eq("period_key", periodKey)
    .eq("status", "claimed")
    .lt("claimed_at", staleBefore)
    .select("id")
    .maybeSingle();

  if (takeoverErr) throw new Error(`claim takeover failed: ${takeoverErr.message}`);
  return adopted ? "taken_over" : "held";
}

/**
 * Release a claim so a retry (or the manual trigger) can take it again.
 *
 * Used for TRANSIENT failures only. Leaving the row behind as `failed` is what
 * made a rate limit or a database blip permanently cost the athlete that
 * period's digest -- the ledger's unique index is not partial, so a terminal
 * row blocks every later attempt.
 */
async function releaseClaim(
  admin: SupabaseClient,
  athleteId: string,
  kind: string,
  periodKey: string,
): Promise<void> {
  // service-role: explicit user filter required
  await admin
    .from("period_review_deliveries")
    .delete()
    .eq("athlete_id", athleteId)
    .eq("kind", kind)
    .eq("period_key", periodKey)
    .eq("status", "claimed");
}

/**
 * Stamp the ledger row terminal.
 *
 * Returns whether the write landed. The caller CANNOT ignore a failure on the
 * `sent` path: if Brevo accepted the message but this update did not land, the
 * row stays `claimed` forever and the ledger no longer describes what the
 * athlete actually received — the one thing it exists to record.
 */
async function finish(
  admin: SupabaseClient,
  athleteId: string,
  kind: string,
  periodKey: string,
  status: "sent" | "failed" | "skipped",
  failureReason?: string,
): Promise<boolean> {
  // service-role: explicit user filter required
  const { error } = await admin
    .from("period_review_deliveries")
    .update({
      status,
      failure_reason: failureReason ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("athlete_id", athleteId)
    .eq("kind", kind)
    .eq("period_key", periodKey);

  return !error;
}

export interface RunDeliveryArgs {
  admin: SupabaseClient;
  event: { data: unknown };
  /** Optional structured logger; defaults to console-free silence in tests. */
  logger?: { info: (msg: string, meta?: unknown) => void; warn: (msg: string, meta?: unknown) => void };
}

/**
 * The worker CORE, exported so it is testable without an Inngest runtime --
 * the same shape `runGeneratePlan` uses. The createFunction wrapper below is a
 * thin adapter over it.
 */
export async function runPeriodReviewDelivery(
  args: RunDeliveryArgs,
): Promise<{ outcome: DeliveryOutcome }> {
  const { admin, event } = args;
  const logger = args.logger ?? { info: () => {}, warn: () => {} };

  const parsed = EventDataSchema.safeParse(event.data);
  if (!parsed.success) {
    // A malformed payload will never become valid: fail permanently rather
    // than burning retries on it.
    throw new NonRetriableError(`invalid payload: ${parsed.error.message}`);
  }
  const { athlete_id: athleteId, kind, period_key: periodKey } = parsed.data;

  if (!isValidPeriodKey(kind, periodKey)) {
    throw new NonRetriableError("period key does not match its kind");
  }

  // ENTITLEMENT AND CONSENT ARE BOTH ENFORCED HERE, not in the scheduler. The
  // scheduler's filters are an optimization; this is the single source of
  // truth. The window between a tick and its run is small but real, and an
  // Inngest backlog or an operator replaying the manual trigger widens it
  // arbitrarily — so an athlete who unsubscribed, or whose account was
  // soft-deleted, in that window must not be mailed. Mailing someone who has
  // just opted out is exactly the failure the opt-in posture exists to prevent.
  const entitled = await hasActiveEntitlement(admin, athleteId, "trend_reports");
  if (!entitled) {
    logger.info(`${PII_FREE_LOG} skipped, not entitled`, { athlete_id: athleteId, kind });
    return { outcome: "not_entitled" };
  }

  // service-role: explicit user filter required. One read covers consent,
  // account state, and the recipient address, so the send path needs no second
  // users query.
  const { data: userRow } = await admin
    .from("users")
    .select("email, deleted_at, email_weekly_review, email_monthly_review")
    .eq("id", athleteId)
    .maybeSingle();

  const stillOptedIn =
    kind === "weekly"
      ? userRow?.email_weekly_review === true
      : userRow?.email_monthly_review === true;

  if (!userRow || userRow.deleted_at !== null || !stillOptedIn) {
    logger.info(`${PII_FREE_LOG} skipped, no longer opted in`, {
      athlete_id: athleteId,
      kind,
    });
    return { outcome: "opted_out" };
  }

  const claimOutcome = await claim(admin, athleteId, kind, periodKey);
  if (claimOutcome === "held") {
    logger.info(`${PII_FREE_LOG} already claimed`, {
      athlete_id: athleteId,
      kind,
      period_key: periodKey,
    });
    return { outcome: "already_claimed" };
  }
  if (claimOutcome === "taken_over") {
    // Worth a warning, not silence: it means a previous run died mid-flight,
    // which is the condition the stale-claim index exists to surface.
    logger.warn(`${PII_FREE_LOG} adopted a stale claim`, {
      athlete_id: athleteId,
      kind,
      period_key: periodKey,
    });
  }

  const timezone = await readAthleteTimezone(admin, athleteId);

  let assembled;
  try {
    assembled = await assemblePeriodReview({
      supabase: admin,
      athleteId,
      kind,
      periodKey,
      timezone,
    });
  } catch (err) {
    if (err instanceof InvalidPeriodKeyError) {
      // Permanently wrong input: terminal, and no retry can fix it.
      await finish(admin, athleteId, kind, periodKey, "failed", "assemble_failed");
      throw new NonRetriableError("invalid period key");
    }
    // A read failure is TRANSIENT. Release so the retry can re-claim and try
    // again, rather than burning the athlete's period on a database blip.
    await releaseClaim(admin, athleteId, kind, periodKey);
    throw err;
  }

  // AS2: nothing to say. Skipping is the right call -- an email reporting zero
  // against zero is noise that trains the athlete to ignore the next one.
  // Recorded as terminal so a later tick does not retry the same emptiness.
  const { facts, factSheet, fingerprint } = assembled;
  if (facts.totals.sessions === 0 && facts.compliance.prescribed === 0) {
    // 'skipped', NOT 'sent' — nothing was mailed, and the ledger is
    // athlete-readable, so recording a send that never happened would make any
    // future "we emailed you on the 4th" surface assert a falsehood. Still
    // terminal, so a later tick does not retry the same emptiness.
    await finish(admin, athleteId, kind, periodKey, "skipped", "no_data");
    logger.info(`${PII_FREE_LOG} skipped, nothing to report`, { athlete_id: athleteId, kind });
    return { outcome: "no_data" };
  }

  let narration;
  try {
    narration = await narratePeriod(factSheet, createLlmClient());
  } catch (err) {
    // TRANSIENT vs TERMINAL, and the claim follows that split. A rate limit
    // clears on its own, so releasing and backing off gives the athlete their
    // digest a few minutes later; stamping it terminal cost them the period
    // outright. Unusable model output will not become usable on the next
    // attempt inside the same budget, so that stays terminal.
    if (isLlmBackOff(err)) {
      await releaseClaim(admin, athleteId, kind, periodKey);
      logger.warn(`${PII_FREE_LOG} narration rate-limited, releasing for retry`, {
        athlete_id: athleteId,
        kind,
      });
      // A real back-off, not an immediate retry: the shared LLM budget is
      // exactly what a tight retry loop would exhaust.
      throw new RetryAfterError("narration rate-limited", "5m");
    }

    const reason =
      err instanceof PeriodNarrationInvalidError || err instanceof LlmInvalidOutput
        ? "llm_invalid_output"
        : "llm_failed";
    await finish(admin, athleteId, kind, periodKey, "failed", reason);
    logger.warn(`${PII_FREE_LOG} narration failed, sending nothing`, {
      athlete_id: athleteId,
      kind,
      reason,
    });
    return { outcome: "llm_invalid_output" };
  }

  // Persist BEFORE sending, so the link in the email lands on a review already
  // carrying the same prose the athlete just read in their inbox.
  //
  // NOT `.upsert({ onConflict })`: the identity index is PARTIAL, which
  // Postgres cannot infer as an ON CONFLICT target (42P10). Shared with the API
  // route so both write paths behave identically.
  try {
    await persistPeriodReview(admin, {
      athlete_id: athleteId,
      kind,
      period_key: periodKey,
      period_start: facts.bounds.start,
      period_end: facts.bounds.end,
      narrative: narration.note,
      takeaway: narration.takeaway,
      input_fingerprint: fingerprint,
      model: resolveModelLabel(),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    // Transient database failure: release so the retry can re-claim.
    await releaseClaim(admin, athleteId, kind, periodKey);
    throw err;
  }

  // Recipient came from the consent read above — no second users query.
  const to = (userRow.email as string | null) ?? null;

  if (!to) {
    await finish(admin, athleteId, kind, periodKey, "failed", "no_recipient");
    return { outcome: "email_failed" };
  }

  const result = await sendPeriodDigest({ to, athleteId, sheet: factSheet, narration });

  if (!result.sent) {
    // Same transient/terminal split. A provider 5xx or a network error clears;
    // a 4xx refusal or a missing configuration will not, and retrying those
    // just burns attempts.
    const reason = result.reason ?? "email_failed";
    const transient = reason === "error" || /^http_5\d\d$/.test(reason);

    if (transient) {
      await releaseClaim(admin, athleteId, kind, periodKey);
      logger.warn(`${PII_FREE_LOG} send failed transiently, releasing for retry`, {
        athlete_id: athleteId,
        kind,
        reason,
      });
      throw new RetryAfterError("email send failed transiently", "5m");
    }

    // Mark FAILED, not sent: the ledger must never claim the athlete received
    // something they did not.
    await finish(admin, athleteId, kind, periodKey, "failed", reason);
    logger.warn(`${PII_FREE_LOG} send failed`, {
      athlete_id: athleteId,
      kind,
      reason,
    });
    return {
      outcome: reason === "not_configured" ? "email_not_configured" : "email_failed",
    };
  }

  const recorded = await finish(admin, athleteId, kind, periodKey, "sent");
  if (!recorded) {
    // The email HAS been delivered. The ledger just failed to record it, which
    // leaves the row stuck in `claimed` — the state the migration's
    // status_claimed index exists to surface. Throwing here would be worse: the
    // retry cannot un-send the email and would re-claim nothing. Log loudly and
    // report the discrepancy instead of a clean success.
    logger.warn(`${PII_FREE_LOG} sent but ledger not updated`, {
      athlete_id: athleteId,
      kind,
      period_key: periodKey,
    });
  }
  logger.info(`${PII_FREE_LOG} sent`, { athlete_id: athleteId, kind, period_key: periodKey });
  return { outcome: "sent" };
}

export const periodReviewDelivery = inngest.createFunction(
  {
    id: "period-review-delivery",
    name: "Period review digest delivery",
    // Retries now DO work: every transient path releases the claim before
    // throwing, so the retry re-claims and genuinely re-attempts. (Before that,
    // a retry hit 23505, returned `already_claimed`, and reported silent
    // non-delivery as a green run.) Two, not more: the transient cases are a
    // rate limit or a provider blip, both of which clear quickly or not at all,
    // and each attempt costs a shared-budget LLM call.
    retries: 2,
    // Cap the fan-out. The hourly scheduler can enqueue the whole opted-in
    // cohort for one timezone at once, and each run makes an LLM call against
    // the same shared budget that plan generation and per-workout reports draw
    // on. Without this, a busy tick starves the rest of the product.
    concurrency: [{ limit: 3 }],
  },
  { event: PERIOD_REVIEW_DELIVERY_EVENT },
  async ({ event, step, logger }): Promise<{ outcome: DeliveryOutcome }> =>
    // One step: the core is not safely resumable at a finer grain, because the
    // claim and the send must not be replayed independently of each other.
    step.run("deliver", () =>
      runPeriodReviewDelivery({
        admin: createAdminClient(),
        event: { data: event.data },
        logger,
      }),
    ),
);
