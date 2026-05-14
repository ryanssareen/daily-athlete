// POST /api/integrations/strava/init
//
// Mints a server-signed OAuth state nonce for the authenticated user.
// Mobile calls this before opening Strava's authorize page, then passes
// the returned `state` as the OAuth state parameter. The /connect route
// HMAC-verifies that state against the same signing key + user_id.
//
// Why this exists:
//   The previous Phase B implementation accepted both `state` and
//   `expected_state` from the same POST body, which provided no CSRF
//   defense (an attacker controlling the body controls both operands).
//   See docs/solutions/strava-oauth.md "State-nonce CSRF protection" for
//   the rationale. The /init -> server-signed -> /connect flow is the
//   replacement.
//
// Auth surface: Bearer token (mobile) or cookie session (browser). Both
// resolve through `resolveAuth()` which falls back cleanly between the
// two so we don't 401 mobile callers who lack cookies.
//
// Logging: log only `{event, user_id, success}`. NEVER log the signed
// state -- exposing it in logs hands an attacker the verifier.

import { NextResponse } from "next/server";

import { createClient as createServerClient } from "@/auth/server";
import { resolveAuth } from "@/auth/bearer";
import { signState } from "@/strava/state-nonce";

// 10 minutes -- expo-auth-session's authorize round trip is typically
// seconds; 10 minutes leaves room for a user to background the app
// briefly between tap and the deep-link callback. Longer windows widen
// the replay surface; shorter windows breaks flaky network paths.
const STATE_TTL_SECONDS = 600;

function logEvent(event: {
  name: string;
  user_id?: string;
  success: boolean;
  code?: string;
}): void {
  // Structured; never logs the state itself (the state is the verifier).
  // eslint-disable-next-line no-console
  console.info(
    `[strava.init] ${event.name}`,
    JSON.stringify({
      user_id: event.user_id,
      success: event.success,
      code: event.code,
    })
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let state: string;
  try {
    state = signState(user.id, STATE_TTL_SECONDS);
  } catch (err) {
    // signState() throws when STRAVA_OAUTH_STATE_SIGNING_KEY is missing.
    // In production config.ts refuses to boot without it, but defense in
    // depth: surface as 500 internal_error rather than echoing the
    // misconfig string verbatim.
    logEvent({
      name: "state_signing_unavailable",
      user_id: user.id,
      success: false,
      code: "internal_error",
    });
    return NextResponse.json(
      {
        error: "internal_error",
        message:
          err instanceof Error
            ? "state signing unavailable"
            : "state signing unavailable",
      },
      { status: 500 }
    );
  }

  logEvent({ name: "strava_oauth_init", user_id: user.id, success: true });
  return NextResponse.json({ state }, { status: 200 });
}
