// POST /api/integrations/strava/connect
//
// Exchanges a Strava authorization code (+ PKCE verifier) for an
// access/refresh token pair, persists the encrypted tokens, and enqueues
// the on-connect backfill job. Mobile (apps/mobile/src/integrations/
// strava.tsx) is the only caller.
//
// Security posture:
// - The Strava client_secret stays on the server; the device never sees it.
// - PKCE end-to-end: code_verifier is generated on-device by
//   expo-auth-session, forwarded here, and passed to Strava unmodified.
// - OAuth `state` is CSRF protection. We compare the inbound `state`
//   against `expected_state` (the value the mobile session generated
//   before the authorize hop) with timing-safe equality. Mismatch -> 400
//   `state_mismatch`. This blocks attacker-substituted-code flows.
// - athlete_strava_id is sourced EXCLUSIVELY from Strava's
//   /oauth/token response. Never accepted from the client body.
// - Re-connect collision (HTTP 409): if a different user already owns
//   this athlete_strava_id, refuse with `strava_account_already_linked`.
//   Silent ownership transfer is rejected as a data-integrity hazard
//   for shared family accounts and an account-takeover surface.
//
// Logging policy (MUST NOT log):
// - code, code_verifier
// - access_token, refresh_token
// - full Strava response body
// - the request body verbatim
// Log only: user_id, athlete_strava_id, success/failure flag, normalized
// error code, and the event name. Reviewers grep this diff for stray
// `console.*` calls.

import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import type { StravaConnectErrorCode } from "@da2/shared";
import { StravaConnectRequestSchema } from "@da2/shared";

import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import {
  findUserByAthleteStravaId,
  upsertStravaToken,
} from "@/db/strava-tokens";
import { inngest } from "@/inngest/client";
import { encrypt } from "@/security/token-crypto";
import { StravaError, StravaReauthRequired } from "@/strava/errors";
import { exchangeAuthorizationCode } from "@/strava/oauth";

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

function safeStateEqual(a: string, b: string): boolean {
  // timingSafeEqual requires same-length buffers; we explicitly pad to
  // the longer side and still let same-length comparison run so timing
  // doesn't leak the prefix-matching boundary either.
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function logEvent(event: {
  name: string;
  user_id?: string;
  athlete_strava_id?: number;
  success: boolean;
  code?: string;
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
    })
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Authenticate the caller via the JWT-bound SSR client. We do NOT
  //    use the service-role client here -- the JWT cookie is what tells
  //    us *which* user is making this request.
  const supabase = await createServerClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
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

  // 3. Validate the OAuth state nonce (CSRF). Compare body.state against
  //    body.expected_state with timing-safe equality. Mismatch -> reject
  //    before calling Strava (no point burning the code on a bad state).
  const stateOk = safeStateEqual(parsed.data.state, parsed.data.expected_state);
  if (!stateOk) {
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
  const admin = createAdminClient();
  const owner = await findUserByAthleteStravaId(
    admin,
    exchange.athleteStravaId
  );
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

  // 6. Encrypt + persist via service-role. The pre-check above means the
  //    user_id-unique upsert will not collide with the
  //    athlete_strava_id unique index.
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
  } catch {
    logEvent({
      name: "token_persist_failed",
      user_id: user.id,
      athlete_strava_id: exchange.athleteStravaId,
      success: false,
      code: "internal_error",
    });
    return errorJson("internal_error", 500);
  }

  // 7. Enqueue the on-connect backfill. Isolate failures: if Inngest is
  //    unreachable, the user IS connected -- log and return 200. The
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

  return NextResponse.json(
    { status: "connected", athlete_strava_id: exchange.athleteStravaId },
    { status: 200 }
  );
}
