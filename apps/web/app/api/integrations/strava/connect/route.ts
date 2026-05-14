// POST /api/integrations/strava/connect
//
// Exchanges a Strava authorization code (+ PKCE verifier) for an
// access/refresh token pair, persists the encrypted tokens, and enqueues
// the on-connect backfill job. Mobile (apps/mobile/src/integrations/
// strava.tsx) is the only caller today.
//
// Security posture:
// - The Strava client_secret stays on the server; the device never sees it.
// - PKCE end-to-end: code_verifier is generated on-device by
//   expo-auth-session, forwarded here, and passed to Strava unmodified.
// - OAuth `state` is server-signed: the mobile client first calls
//   /api/integrations/strava/init to obtain an HMAC-signed state bound
//   to its user_id. This route verifies the signature against the same
//   signing key + the authenticated user_id. The previous design (both
//   `state` and `expected_state` from the body) provided no CSRF defense
//   because the attacker controlled both operands.
// - athlete_strava_id is sourced EXCLUSIVELY from Strava's
//   /oauth/token response. Never accepted from the client body.
// - Re-connect collision (HTTP 409): if a different user already owns
//   this athlete_strava_id, refuse with `strava_account_already_linked`.
//   Silent ownership transfer is rejected as a data-integrity hazard
//   for shared family accounts and an account-takeover surface. The
//   pre-check is a fast path; the unique-constraint on the upsert is
//   the race arbiter (typed as StravaAccountCollisionError -> 409).
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

import { NextResponse } from "next/server";

import type { StravaConnectErrorCode } from "@da2/shared";
import { StravaConnectRequestSchema } from "@da2/shared";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import {
  findUserByAthleteStravaId,
  upsertStravaToken,
} from "@/db/strava-tokens";
import { inngest } from "@/inngest/client";
import { encrypt } from "@/security/token-crypto";
import {
  StravaAccountCollisionError,
  StravaError,
  StravaReauthRequired,
} from "@/strava/errors";
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

  // 5. Re-connect collision check. If another user already owns this
  //    athlete_strava_id, reject with 409. Same-user reconnect proceeds.
  //    If the lookup itself fails, surface 500 with a logged event --
  //    don't let a plain DB error escape as an unstructured Next.js 500.
  const admin = createAdminClient();
  let owner;
  try {
    owner = await findUserByAthleteStravaId(admin, exchange.athleteStravaId);
  } catch (err) {
    logEvent({
      name: "owner_lookup_failed",
      user_id: user.id,
      athlete_strava_id: exchange.athleteStravaId,
      success: false,
      code: "internal_error",
      extra: { err: err instanceof Error ? err.message : String(err) },
    });
    return errorJson("internal_error", 500);
  }
  if (owner && owner.user_id !== user.id) {
    logEvent({
      name: "account_collision",
      user_id: user.id,
      athlete_strava_id: exchange.athleteStravaId,
      success: false,
      code: "strava_account_already_linked",
    });
    return errorJson("strava_account_already_linked", 409);
  }

  // 5b. Same-user reconnect with a DIFFERENT athlete_strava_id is a
  //     policy decision we defer to Phase C (does that orphan the prior
  //     athlete's workout_matches? do we cascade-delete? do we prompt?).
  //     For Phase B, log the event so we can monitor frequency and
  //     decide before C ships. Behavior unchanged today (the upsert
  //     proceeds and overwrites athlete_strava_id).
  if (owner && owner.user_id === user.id) {
    // We don't have the previous athlete_strava_id from a single SELECT
    // (the helper returns only user_id). For the log signal, indicate
    // the owner check matched same-user; the new athlete_strava_id is
    // the post-upsert state. If a future operator wants the old value
    // they should add it to the lookup helper.
    logEvent({
      name: "same_user_reconnect",
      user_id: user.id,
      athlete_strava_id: exchange.athleteStravaId,
      success: true,
    });
  }

  // 6. Encrypt + persist via service-role. The pre-check above means the
  //    user_id-unique upsert will not collide with the
  //    athlete_strava_id unique index in the sequential case. In the
  //    concurrent case (two users connecting the same Strava account
  //    simultaneously, both passing the pre-check), the upsert's
  //    unique-constraint violation is caught as
  //    StravaAccountCollisionError -> 409.
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
    if (err instanceof StravaAccountCollisionError) {
      logEvent({
        name: "account_collision_race",
        user_id: user.id,
        athlete_strava_id: exchange.athleteStravaId,
        success: false,
        code: "strava_account_already_linked",
      });
      return errorJson("strava_account_already_linked", 409);
    }
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

  // 7. Enqueue the on-connect backfill. Isolate failures: if Inngest is
  //    unreachable, the user IS connected -- log and return 202. The
  //    backfill can be re-triggered later (Phase C2 progress UI surfaces
  //    re-trigger affordance).
  try {
    await inngest.send({
      name: "strava/backfill.start",
      data: { user_id: user.id },
    });
  } catch {
    logEvent({
      name: "backfill_start_enqueue_failed",
      user_id: user.id,
      athlete_strava_id: exchange.athleteStravaId,
      success: true, // user is connected; this is a soft failure
      code: "internal_error",
    });
  }

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
