import "server-only";

// Webhook subscription health probe (issue #97 follow-up).
//
// The outage in #97 was a "split-brain" between two independent facts:
//   1. what STRAVA_WEBHOOK_SUBSCRIPTION_ID says our subscription id is, and
//   2. what push subscription (if any) actually exists on Strava's side.
// When they disagree — env unset but a subscription exists, env set but no
// live subscription, or the two ids differ — every incoming webhook event is
// dropped at the subscription-id gate and no activity auto-syncs, with no
// signal tying the drops to the cause.
//
// This probe fetches the live subscription with the app credentials and
// compares it to the configured id, returning a single closed status the
// reconcile cron logs (and surfaces in its response) so the mismatch is
// visible on day one instead of week two.

import { z } from "zod";

import { config } from "@/config";
import { STRAVA_API_BASE, STRAVA_API_FETCH_TIMEOUT_MS } from "@/strava/constants";

export type SubscriptionHealthStatus =
  // env id matches the single live subscription — nominal
  | "healthy"
  // env set, but Strava reports no push subscription at all
  | "env_set_no_subscription"
  // env set and a subscription exists, but the ids differ (stale/rotated env)
  | "id_mismatch"
  // a live subscription exists but the env var is unset (events get dropped)
  | "subscription_exists_env_unset"
  // neither configured nor registered — webhook auto-sync is simply off
  | "no_subscription_env_unset"
  // Strava app is Inactive: 403 on the subscriptions endpoint (and everything)
  | "app_inactive"
  // client id/secret not configured — cannot probe
  | "unconfigured"
  // network error / unexpected non-ok response
  | "probe_failed";

export interface SubscriptionHealth {
  status: SubscriptionHealthStatus;
  /** STRAVA_WEBHOOK_SUBSCRIPTION_ID parsed from config, if set. */
  configuredId: number | undefined;
  /** The id of the live push subscription Strava reports, if any. */
  liveId: number | null;
  /** True only when status === "healthy". Convenience for callers/logs. */
  ok: boolean;
}

const PushSubscriptionSchema = z.object({ id: z.number().int().positive() });
const PushSubscriptionsResponseSchema = z.array(PushSubscriptionSchema);

/**
 * Probe the live Strava push subscription and compare it to the configured
 * STRAVA_WEBHOOK_SUBSCRIPTION_ID. Never throws — a probe failure is a status,
 * not an exception, so it can't abort the reconcile sweep it runs alongside.
 */
export async function checkStravaSubscriptionHealth(): Promise<SubscriptionHealth> {
  const configuredId = config.strava.webhookSubscriptionId;
  const clientId = config.strava.clientId;
  const clientSecret = config.strava.clientSecret;

  const base: Omit<SubscriptionHealth, "status" | "ok"> = {
    configuredId,
    liveId: null,
  };
  const done = (
    status: SubscriptionHealthStatus,
    liveId: number | null = base.liveId
  ): SubscriptionHealth => ({
    status,
    configuredId,
    liveId,
    ok: status === "healthy",
  });

  if (!clientId || !clientSecret) {
    return done("unconfigured");
  }

  const url = `${STRAVA_API_BASE}/push_subscriptions?client_id=${encodeURIComponent(
    clientId
  )}&client_secret=${encodeURIComponent(clientSecret)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(STRAVA_API_FETCH_TIMEOUT_MS),
    });
  } catch {
    // Network/timeout — never leak the raw error; the status is enough signal.
    return done("probe_failed");
  }

  if (response.status === 403) {
    // Strava returns 403 { resource:"Application", field:"Status",
    // code:"Inactive" } for every call once the app is deactivated.
    return done("app_inactive");
  }
  if (!response.ok) {
    return done("probe_failed");
  }

  let liveId: number | null;
  try {
    const subs = PushSubscriptionsResponseSchema.parse(await response.json());
    liveId = subs.length > 0 ? subs[0]!.id : null;
  } catch {
    return done("probe_failed");
  }

  if (configuredId === undefined) {
    return done(
      liveId === null ? "no_subscription_env_unset" : "subscription_exists_env_unset",
      liveId
    );
  }
  if (liveId === null) {
    return done("env_set_no_subscription");
  }
  return done(liveId === configuredId ? "healthy" : "id_mismatch", liveId);
}
