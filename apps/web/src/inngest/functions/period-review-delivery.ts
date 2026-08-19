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
// R15/AE10 -- A FAILED NARRATION SENDS NOTHING. The API route degrades to
// facts-with-a-retry-button because a human is watching and can ask again. Here
// there is no one to ask: a digest email without its narration is a table of
// numbers with no coaching in it, which is not the product. The claim is
// released (status 'failed' with a non-PII reason) and no mail goes out.
//
// NO PII ANYWHERE IN THE JOB. The event payload carries ids; the email address
// is read inside the step and never logged, never returned, never stored in
// Inngest history.

import { NonRetriableError } from "inngest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { PeriodKindSchema, isValidPeriodKey } from "@da2/shared";

import { assemblePeriodReview, readAthleteTimezone } from "@/ai/period-reviews/assemble";
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
  | "assemble_failed";

const PII_FREE_LOG = "[period-review.delivery]";

/**
 * Claim (athlete, kind, period). Returns false when someone already has it.
 *
 * A unique violation is the EXPECTED contention outcome, not an error: it means
 * another worker owns this period, so this one exits quietly. Any other error
 * propagates so Inngest retries.
 */
async function claim(
  admin: SupabaseClient,
  athleteId: string,
  kind: string,
  periodKey: string,
): Promise<boolean> {
  // service-role: explicit user filter required
  const { error } = await admin.from("period_review_deliveries").insert({
    athlete_id: athleteId,
    kind,
    period_key: periodKey,
    status: "claimed",
  });

  if (!error) return true;
  if (error.code === "23505") return false; // unique_violation — already claimed
  throw new Error(`claim failed: ${error.message}`);
}

async function finish(
  admin: SupabaseClient,
  athleteId: string,
  kind: string,
  periodKey: string,
  status: "sent" | "failed",
  failureReason?: string,
): Promise<void> {
  // service-role: explicit user filter required
  await admin
    .from("period_review_deliveries")
    .update({
      status,
      failure_reason: failureReason ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("athlete_id", athleteId)
    .eq("kind", kind)
    .eq("period_key", periodKey);
}

function resolveModelLabel(): string {
  const { anthropicApiKey, groqApiKey, provider, model } = config.llm;
  if (model) return model;
  const resolved = provider ?? (anthropicApiKey ? "anthropic" : groqApiKey ? "groq" : undefined);
  return resolved === "groq" ? "llama-3.3-70b-versatile" : "claude-opus-4-8";
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

  // ENTITLEMENT IS ENFORCED HERE, not in the scheduler. The scheduler's filters
  // are an optimization; this is the single source of truth, so an athlete
  // whose subscription lapsed between tick and run is not mailed.
  const entitled = await hasActiveEntitlement(admin, athleteId, "trend_reports");
  if (!entitled) {
    logger.info(`${PII_FREE_LOG} skipped, not entitled`, { athlete_id: athleteId, kind });
    return { outcome: "not_entitled" };
  }

  const claimed = await claim(admin, athleteId, kind, periodKey);
  if (!claimed) {
    logger.info(`${PII_FREE_LOG} already claimed`, {
      athlete_id: athleteId,
      kind,
      period_key: periodKey,
    });
    return { outcome: "already_claimed" };
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
    await finish(admin, athleteId, kind, periodKey, "failed", "assemble_failed");
    if (err instanceof InvalidPeriodKeyError) throw new NonRetriableError("invalid period key");
    throw err;
  }

  // AS2: nothing to say. Skipping is the right call -- an email reporting zero
  // against zero is noise that trains the athlete to ignore the next one.
  // Recorded as terminal so a later tick does not retry the same emptiness.
  const { facts, factSheet, fingerprint } = assembled;
  if (facts.totals.sessions === 0 && facts.compliance.prescribed === 0) {
    await finish(admin, athleteId, kind, periodKey, "sent", "no_data");
    logger.info(`${PII_FREE_LOG} skipped, nothing to report`, { athlete_id: athleteId, kind });
    return { outcome: "no_data" };
  }

  let narration;
  try {
    narration = await narratePeriod(factSheet, createLlmClient());
  } catch (err) {
    const rateLimited = isLlmBackOff(err);
    const reason = rateLimited
      ? "llm_rate_limited"
      : err instanceof PeriodNarrationInvalidError || err instanceof LlmInvalidOutput
        ? "llm_invalid_output"
        : "llm_failed";
    await finish(admin, athleteId, kind, periodKey, "failed", reason);
    logger.warn(`${PII_FREE_LOG} narration failed, sending nothing`, {
      athlete_id: athleteId,
      kind,
      reason,
    });
    // Returned rather than thrown: a modeled outcome. Throwing would burn the
    // retry on a condition the retry cannot fix inside the window that matters.
    return { outcome: rateLimited ? "llm_rate_limited" : "llm_invalid_output" };
  }

  // Persist BEFORE sending, so the link in the email lands on a review already
  // carrying the same prose the athlete just read in their inbox.
  // service-role: explicit user filter required
  const { error: upsertErr } = await admin.from("period_reviews").upsert(
    {
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
      deleted_at: null,
    },
    { onConflict: "athlete_id,kind,period_key" },
  );
  if (upsertErr) {
    await finish(admin, athleteId, kind, periodKey, "failed", "persist_failed");
    throw new Error(`persist failed: ${upsertErr.message}`);
  }

  // service-role: explicit user filter required
  const { data: userRow } = await admin
    .from("users")
    .select("email")
    .eq("id", athleteId)
    .maybeSingle();
  const to = (userRow?.email as string | null) ?? null;

  if (!to) {
    await finish(admin, athleteId, kind, periodKey, "failed", "no_recipient");
    return { outcome: "email_failed" };
  }

  const result = await sendPeriodDigest({ to, athleteId, sheet: factSheet, narration });

  if (!result.sent) {
    // Mark FAILED, not sent: the ledger must never claim the athlete received
    // something they did not.
    await finish(admin, athleteId, kind, periodKey, "failed", result.reason ?? "email_failed");
    logger.warn(`${PII_FREE_LOG} send failed`, {
      athlete_id: athleteId,
      kind,
      reason: result.reason,
    });
    return {
      outcome: result.reason === "not_configured" ? "email_not_configured" : "email_failed",
    };
  }

  await finish(admin, athleteId, kind, periodKey, "sent");
  logger.info(`${PII_FREE_LOG} sent`, { athlete_id: athleteId, kind, period_key: periodKey });
  return { outcome: "sent" };
}

export const periodReviewDelivery = inngest.createFunction(
  {
    id: "period-review-delivery",
    name: "Period review digest delivery",
    // One retry. A rate-limited narration is not worth hammering -- the shared
    // Groq budget is exactly what a retry storm would exhaust -- and a
    // retrospective that arrives days late is worse than one that never
    // arrives. The claim survives the retry, so a retry cannot double-send.
    retries: 1,
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
