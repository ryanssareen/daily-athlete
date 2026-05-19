// GET /api/integrations/strava/mobile-bounce
//
// Strava OAuth allows only ONE Authorization Callback Domain per
// application. The DA2 OAuth app's domain is `da2-one.vercel.app` (web).
// The Flutter app needs the OAuth response delivered to its `da2://`
// deep-link scheme, which Strava cannot redirect to directly under the
// current app config.
//
// This route is a stateless redirect that lives on the registered
// callback domain and bounces the OAuth result to the mobile scheme:
//
//   Strava → /api/integrations/strava/mobile-bounce?code=…&state=…
//          → 302 Location: da2://strava-oauth?code=…&state=…
//          → app_links picks it up in the Flutter app
//
// The mobile client passes this URL as its `redirect_uri` on both the
// authorize hop and the subsequent /connect POST. The /connect handler
// forwards the same `redirect_uri` to Strava's /oauth/token call, which
// Strava requires to match the authorize hop exactly.
//
// Security:
// - This route performs no DB writes, no token exchange, no logging of
//   `code` or `state`. The HMAC-signed state nonce is still verified
//   server-side at /connect, before any code is exchanged.
// - The `da2://` scheme is hijackable on Android; PKCE remains the
//   load-bearing mitigation. See docs/solutions/strava-oauth.md.
// - The route accepts only Strava's documented success/error params and
//   forwards them verbatim. Any other query keys are dropped so a
//   crafted URL cannot inject arbitrary content into the deep link.

import { NextResponse } from "next/server";

// The custom-scheme target the Flutter app listens for. Must match the
// scheme registered in daily-athlete/ios/Runner/Info.plist and the path
// the Flutter StravaDeepLinkBridge filters on.
const DEEP_LINK_TARGET = "da2://strava-oauth";

// Query-param allowlist. Strava sends these (and only these) on the
// OAuth redirect; anything else is ignored to prevent injection of
// unexpected fragments into the deep link.
const ALLOWED_PARAMS = ["code", "state", "scope", "error"] as const;

export async function GET(request: Request): Promise<NextResponse> {
  const incoming = new URL(request.url);
  const target = new URL(DEEP_LINK_TARGET);

  for (const key of ALLOWED_PARAMS) {
    const value = incoming.searchParams.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }

  return NextResponse.redirect(target.toString(), 302);
}
