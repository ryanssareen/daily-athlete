// POST /api/integrations/strava/connect
//
// Exchanges a Strava authorization code (+ PKCE verifier) for an
// access/refresh token pair, persists the encrypted tokens, and enqueues
// the on-connect backfill job. The Flutter mobile app (daily-athlete/) is
// the only caller today -- see docs/solutions/strava-oauth.md.
//
// Security posture:
// - The Strava client_secret stays on the server; the device never sees it.
// - PKCE end-to-end: code_verifier is generated on-device (Flutter's
//   `crypto` package), forwarded here, and passed to Strava unmodified.
// - OAuth `state` is server-signed: the mobile client first calls
//   /api/integrations/strava/init to obtain an HMAC-signed state bound
//   to its user_id. This route verifies the signature against the same
//   signing key + the authenticated user_id. The previous design (both
//   `state` and `expected_state` from the body) provided no CSRF defense
//   because the attacker controlled both operands.
// - athlete_strava_id is sourced EXCLUSIVELY from Strava's
//   /oauth/token response. Never accepted from the client body.
// - Many-to-one linking is allowed on purpose: multiple DA2 users may
//   connect the same Strava account (shared family Strava, coach testing
//   an athlete's account, etc). athlete_strava_id has no uniqueness
//   constraint; each user_id gets its own strava_tokens row and its own
//   token pair. Incoming webhook events fan out to every linked user --
//   see the webhook route for details, including the one accepted gap
//   (a deauth event disconnects all users sharing that Strava account,
//   since Strava's event doesn't identify which grant was revoked).
// - Bearer-token auth: mobile sends `Authorization: Bearer <jwt>` since
//   it doesn't share the SSR cookie jar. resolveAuth() reads either.
//
// Logging policy (MUST NOT log):
// - code, code_verifier
// - access_token, refresh_token
// - full Strava response body
// - the request body verbatim
// - the signed `state` value (it IS the verifier)
// Log only: user_id, athlete_strava_id, success/failure flag, normalized
// error code, and the event name. Reviewers grep this diff for stray
// `console.*` calls.

import { after, NextResponse } from "next/server";

// Backfill runs after the response via `after()`. 60s is the Hobby-plan max;
// enough for 1 Strava page fetch + ~200 DB writes in normal conditions.
export const maxDuration = 60;

import type { StravaConnectErrorCode } from "@da2/shared";
import { StravaConnectRequestSchema } from "@da2/shared";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { upsertStravaToken } from "@/db/strava-tokens";
import { encrypt } from "@/security/token-crypto";
import { runBackfillForUser } from "@/strava/run-backfill";
import { StravaError, StravaReauthRequired } from "@/strava/errors";
import { exchangeAuthorizationCode } from "@/strava/oauth";
import { verifyState } from "@/strava/state-nonce";

function errorJson(
  code: StravaConnectErrorCode,
  status: number,
  message?: string
): NextResponse {
  // Normalized error envelope. Strava's raw response body is never
  // forwarded -- mobile branches on `error` codes only.
  return NextResponse.json(
    message ? { error: code, message } : { error: code },
    { status }
  );
}

function logEvent(event: {
  name: string;
  user_id?: string;
  athlete_strava_id?: number;
  success: boolean;
  code?: string;
  extra?: Record<string, unknown>;
}): void {
  // Deliberately structured: greppable, no template-literal interpolation
  // of secret fields. The `name` is the stable event identifier
  // operations can alert on.
  // eslint-disable-next-line no-console
  console.info(
    `[strava.connect] ${event.name}`,
    JSON.stringify({
      user_id: event.user_id,
      athlete_strava_id: event.athlete_strava_id,
      success: event.success,
      code: event.code,
      ...(event.extra ?? {}),
    })
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Authenticate the caller. resolveAuth handles both:
  //    - SSR cookie session (browser callers)
  //    - Authorization: Bearer <jwt> (mobile callers without cookies)
  //    Service-role admin client used later is a separate concern; this
  //    step only establishes WHICH user is making the request.
  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return errorJson("unauthorized", 401);
  }

  // 2. Parse + validate the body shape.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    logEvent({ name: "invalid_json", user_id: user.id, success: false });
    return errorJson("invalid_input", 400, "request body was not valid JSON");
  }
  const parsed = StravaConnectRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    logEvent({ name: "invalid_input", user_id: user.id, success: false });
    return errorJson("invalid_input", 400);
  }

  // 3. Verify the server-signed state nonce (CSRF). The state was minted
  //    by POST /init for THIS user; if it doesn't HMAC-verify against
  //    the signing key + user.id, reject before calling Strava. We do
  //    NOT log the state value itself.
  if (!verifyState(user.id, parsed.data.state)) {
    logEvent({
      name: "state_mismatch",
      user_id: user.id,
      success: false,
      code: "state_mismatch",
    });
    return errorJson("state_mismatch", 400);
  }

  // 4. Exchange the authorization code with Strava.
  let exchange;
  try {
    exchange = await exchangeAuthorizationCode({
      code: parsed.data.code,
      codeVerifier: parsed.data.code_verifier,
      redirectUri: parsed.data.redirect_uri,
    });
  } catch (err) {
    if (err instanceof StravaReauthRequired) {
      logEvent({
        name: "exchange_rejected",
        user_id: user.id,
        success: false,
        code: "strava_rejected_code",
      });
      return errorJson("strava_rejected_code", 400);
    }
    if (err instanceof StravaError && err.code === "network") {
      logEvent({
        name: "exchange_network_error",
        user_id: user.id,
        success: false,
        code: "strava_unreachable",
      });
      return errorJson("strava_unreachable", 502);
    }
    logEvent({
      name: "exchange_unexpected",
      user_id: user.id,
      success: false,
      code: "internal_error",
    });
    return errorJson("internal_error", 500);
  }

  // 5. Encrypt + persist via service-role. Multiple DA2 users may link the
  //    same Strava account (e.g. shared family Strava, coach/athlete
  //    testing the same account) -- athlete_strava_id has no uniqueness
  //    constraint, so this is a plain per-user upsert with no ownership
  //    check. See apps/web/app/api/integrations/strava/webhook/route.ts
  //    for how incoming events fan out to every linked user.
  const admin = createAdminClient();
  const encAccess = encrypt(new TextEncoder().encode(exchange.accessToken));
  const encRefresh = encrypt(new TextEncoder().encode(exchange.refreshToken));
  try {
    await upsertStravaToken(admin, {
      user_id: user.id,
      access_token_enc: encAccess.ciphertext,
      refresh_token_enc: encRefresh.ciphertext,
      expires_at: exchange.expiresAtIso,
      scope: exchange.scope,
      athlete_strava_id: exchange.athleteStravaId,
      key_version: encAccess.keyVersion,
    });
  } catch (err) {
    logEvent({
      name: "token_persist_failed",
      user_id: user.id,
      athlete_strava_id: exchange.athleteStravaId,
      success: false,
      code: "internal_error",
      extra: { err: err instanceof Error ? err.message : String(err) },
    });
    return errorJson("internal_error", 500);
  }

  // 6. Kick off the backfill after this response is sent. `after()` runs
  //    the callback within Vercel's function timeout (60s on Hobby) after
  //    the 202 is delivered to the client. Progress is tracked in
  //    athlete_profiles.backfill_status; mobile polls to show live state.
  after(() => runBackfillForUser(user.id));

  logEvent({
    name: "connected",
    user_id: user.id,
    athlete_strava_id: exchange.athleteStravaId,
    success: true,
  });

  // 202 Accepted: the user IS connected (token row written) but the
  // backfill job is asynchronous. AGENTS.md §Background jobs mandates
  // 202 for enqueue routes.
  return NextResponse.json(
    { status: "connected", athlete_strava_id: exchange.athleteStravaId },
    { status: 202 }
  );
}
