// GET /api/integrations/strava/authorize
//
// Server-side entry point for the web Strava OAuth flow. The athlete
// profile page links here; this route:
//   1. Verifies the user is authenticated (cookie session).
//   2. Generates a PKCE verifier + SHA-256 challenge (server-side, no
//      client-side crypto needed).
//   3. Mints a server-signed state nonce (same mechanism as /init for
//      mobile). The state binds the OAuth round-trip to this user_id.
//   4. Stores the verifier + redirectUri in a short-lived httpOnly cookie
//      so the /callback route can complete the exchange.
//   5. Redirects the browser to Strava's authorize page.
//
// The client_secret never leaves the server. The code-for-token exchange
// happens in /api/integrations/strava/callback, which imports and calls
// the same POST handler as the mobile /connect route.
//
// PKCE note: Strava supports code_challenge_method=S256. The verifier is
// 32 random bytes (base64url), the challenge is SHA-256(verifier) as
// base64url. Both are generated here -- the browser sends neither.

import { createHash, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { createClient as createServerClient } from "@/auth/server";
import { config } from "@/config";
import { signState } from "@/strava/state-nonce";

const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_SCOPES = "activity:read,activity:read_all,profile:read_all";
const STATE_TTL_SECONDS = 600;
// Cookie name used to pass the PKCE verifier to /callback.
const PKCE_COOKIE = "strava_pkce";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const profileUrl = new URL("/athlete/profile", url.origin);

  // 1. Auth check — cookie session only (this is a browser flow).
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", url.origin));
  }

  // 2. PKCE — generate verifier and S256 challenge server-side.
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  // 3. Mint server-signed state nonce (CSRF protection).
  let state: string;
  try {
    state = signState(user.id, STATE_TTL_SECONDS);
  } catch {
    profileUrl.searchParams.set("strava_error", "config_error");
    return NextResponse.redirect(profileUrl);
  }

  // 4. Store verifier in a short-lived httpOnly cookie. The /callback route
  //    reads this to complete the exchange.
  const redirectUri = `${url.origin}/api/integrations/strava/callback`;
  const pkcePayload = JSON.stringify({ verifier, redirectUri });
  const isSecure = url.protocol === "https:";
  const cookieValue = [
    `${PKCE_COOKIE}=${encodeURIComponent(pkcePayload)}`,
    "HttpOnly",
    isSecure ? "Secure" : "",
    "SameSite=Lax",
    `Max-Age=${STATE_TTL_SECONDS}`,
    "Path=/",
  ]
    .filter(Boolean)
    .join("; ");

  // 5. Build Strava authorize URL and redirect.
  const clientId = config.strava.clientId ?? "";
  const stravaParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: STRAVA_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const response = NextResponse.redirect(
    `${STRAVA_AUTH_URL}?${stravaParams.toString()}`
  );
  response.headers.set("Set-Cookie", cookieValue);
  return response;
}
