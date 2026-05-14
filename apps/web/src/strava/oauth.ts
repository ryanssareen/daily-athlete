// Strava OAuth helpers used by the connect route. Code-for-token exchange
// happens here (server-side) so the client_secret never lives on a
// device.
//
// The refresh-token path lives in StravaClient (apps/web/src/strava/client.ts);
// this module covers the initial authorization-code exchange only.
//
// All Strava fetches go through `postStravaOauthForm` (http.ts) which
// handles AbortSignal.timeout(), network-error wrapping, and JSON
// parsing -- this file becomes a thin caller that interprets the
// status code in the authorization-code context (400 -> code rejected).

import { config } from "@/config";

import { StravaError, StravaReauthRequired } from "./errors";
import { postStravaOauthForm } from "./http";

export interface StravaAuthorizeResult {
  accessToken: string;
  refreshToken: string;
  expiresAtIso: string;
  scope: string;
  athleteStravaId: number;
}

interface RawAuthorizeResponse {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  scope?: string;
  athlete?: { id?: number };
}

export interface ExchangeOptions {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

/**
 * Exchange an authorization code (+ PKCE verifier) for a token pair. The
 * code is single-use; Strava returns 400 on replay (handled as
 * `strava_rejected_code` by the route, never echoed verbatim).
 */
export async function exchangeAuthorizationCode(
  opts: ExchangeOptions
): Promise<StravaAuthorizeResult> {
  const clientId = config.strava.clientId;
  const clientSecret = config.strava.clientSecret;
  if (!clientId || !clientSecret) {
    throw new StravaError(
      "unexpected",
      "Strava client credentials not configured"
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code: opts.code,
    code_verifier: opts.codeVerifier,
    redirect_uri: opts.redirectUri,
  });

  const { status, body: parsedBody } = await postStravaOauthForm(body);

  if (status === 400 || status === 401) {
    // Strava signals an invalid/used code with 400 (and occasionally 401
    // when the client_id mismatch combines with a stale code); surface
    // as a typed "rejected code" error so the route returns a normalized
    // error code rather than the raw Strava body.
    throw new StravaReauthRequired(
      "Strava rejected the authorization code (invalid, expired, or reused)"
    );
  }

  const parsed = parsedBody as RawAuthorizeResponse | null;

  if (
    !parsed ||
    !parsed.access_token ||
    !parsed.refresh_token ||
    typeof parsed.expires_at !== "number" ||
    typeof parsed.scope !== "string" ||
    !parsed.athlete ||
    typeof parsed.athlete.id !== "number"
  ) {
    throw new StravaError(
      "unexpected",
      "Strava /oauth/token response missing required fields"
    );
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAtIso: new Date(parsed.expires_at * 1000).toISOString(),
    scope: parsed.scope,
    athleteStravaId: parsed.athlete.id,
  };
}
