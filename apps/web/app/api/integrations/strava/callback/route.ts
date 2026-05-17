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

function redirectBack(
  origin: string,
  next: string,
  outcome: { connected: true } | { error: string }
): NextResponse {
  // Same-origin guard — see /authorize for the matching policy.
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/athlete/profile";
  const dest = new URL(safeNext, origin);
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

  // Read the PKCE verifier cookie set by /authorize. We may need `next`
  // even for the early-exit (cancelled / invalid) paths so the user
  // bounces back to the page they launched from.
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieMatch = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${PKCE_COOKIE}=([^;]+)`)
  );
  let pkce: { verifier?: string; redirectUri?: string; next?: string } = {};
  if (cookieMatch) {
    try {
      pkce = JSON.parse(decodeURIComponent(cookieMatch[1]));
    } catch {
      pkce = {};
    }
  }
  const next = pkce.next ?? "";

  // User denied access on Strava's page.
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return redirectBack(origin, next, { error: "cancelled" });
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return redirectBack(origin, next, { error: "invalid_callback" });
  }

  if (!cookieMatch) {
    return redirectBack(origin, next, { error: "session_expired" });
  }

  if (!pkce.verifier || !pkce.redirectUri) {
    return redirectBack(origin, next, { error: "invalid_state" });
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
    return redirectBack(origin, next, { connected: true });
  }

  // Map the connect route's error code to a URL param on the same
  // destination the user launched from.
  let errorCode = "unknown";
  try {
    const body = (await connectResponse.json()) as { error?: string };
    errorCode = body.error ?? "unknown";
  } catch {
    // ignore parse failure; errorCode stays "unknown"
  }
  return redirectBack(origin, next, { error: errorCode });
}
