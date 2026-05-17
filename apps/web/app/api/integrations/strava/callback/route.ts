// GET /api/integrations/strava/callback
//
// Strava redirects here after the user authorizes (or denies) access on
// web. This route completes the OAuth code exchange by delegating to the
// same POST /api/integrations/strava/connect handler used by mobile.
//
// Flow:
//   1. Strava sends ?code=...&state=... (or ?error=access_denied).
//   2. We read the PKCE verifier from the `strava_pkce` httpOnly cookie
//      set by /authorize. This is a one-time use value — we clear the
//      cookie regardless of outcome.
//   3. We verify the user is still authenticated (cookie session).
//   4. We construct the same request body that mobile sends to /connect,
//      then import and call the POST handler directly (no HTTP hop).
//   5. On success → redirect to /athlete/profile?strava_connected=1.
//      On error  → redirect to /athlete/profile?strava_error=<code>.
//
// Security:
// - The state HMAC is verified by the /connect POST handler (same path as
//   mobile). We don't duplicate that check here.
// - Clearing the PKCE cookie on every outcome prevents replay even if the
//   user navigates back to this URL.

import { NextResponse } from "next/server";

import { POST as connectPOST } from "../connect/route";

// The Strava token exchange + DB write can take a few seconds.
export const maxDuration = 60;

const PKCE_COOKIE = "strava_pkce";
const CLEAR_COOKIE = `${PKCE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;

function redirectToProfile(
  origin: string,
  outcome: { connected: true } | { error: string }
): NextResponse {
  const dest = new URL("/athlete/profile", origin);
  if ("connected" in outcome) {
    dest.searchParams.set("strava_connected", "1");
  } else {
    dest.searchParams.set("strava_error", outcome.error);
  }
  const res = NextResponse.redirect(dest);
  res.headers.set("Set-Cookie", CLEAR_COOKIE);
  return res;
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const origin = url.origin;

  // User denied access on Strava's page.
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return redirectToProfile(origin, { error: "cancelled" });
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return redirectToProfile(origin, { error: "invalid_callback" });
  }

  // Read the PKCE verifier cookie set by /authorize.
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${PKCE_COOKIE}=([^;]+)`)
  );
  if (!match) {
    return redirectToProfile(origin, { error: "session_expired" });
  }

  let pkce: { verifier: string; redirectUri: string };
  try {
    pkce = JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return redirectToProfile(origin, { error: "invalid_state" });
  }

  if (!pkce.verifier || !pkce.redirectUri) {
    return redirectToProfile(origin, { error: "invalid_state" });
  }

  // Delegate to the connect route — same logic mobile uses, reads the
  // cookie session for auth (resolveAuth handles both Bearer + cookies).
  const connectReq = new Request(
    new URL("/api/integrations/strava/connect", origin),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Forward the browser's session cookie so resolveAuth can
        // authenticate the request.
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        code,
        code_verifier: pkce.verifier,
        redirect_uri: pkce.redirectUri,
        state,
      }),
    }
  );

  const connectResponse = await connectPOST(connectReq);

  if (connectResponse.status === 202) {
    return redirectToProfile(origin, { connected: true });
  }

  // Map the connect route's error code to a profile URL param.
  let errorCode = "unknown";
  try {
    const body = (await connectResponse.json()) as { error?: string };
    errorCode = body.error ?? "unknown";
  } catch {
    // ignore parse failure; errorCode stays "unknown"
  }
  return redirectToProfile(origin, { error: errorCode });
}
