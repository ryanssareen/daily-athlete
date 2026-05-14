// Strava OAuth helpers used by the connect route. Code-for-token exchange
// happens here (server-side) so the client_secret never lives on a
// device.
//
// The refresh-token path lives in StravaClient (apps/web/src/strava/client.ts);
// this module covers the initial authorization-code exchange only.

import { config } from "@/config";

import { StravaError, StravaReauthRequired } from "./errors";

const STRAVA_OAUTH_TOKEN_URL = "https://www.strava.com/oauth/token";

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

  let response: Response;
  try {
    response = await fetch(STRAVA_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    throw new StravaError(
      "network",
      `Strava /oauth/token unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (response.status === 400) {
    // Strava signals an invalid/used code with 400; surface as a typed
    // "rejected code" error so the route returns a normalized error code
    // rather than the raw Strava body.
    throw new StravaReauthRequired(
      "Strava rejected the authorization code (invalid, expired, or reused)"
    );
  }
  if (!response.ok) {
    throw new StravaError(
      "unexpected",
      `Strava /oauth/token returned ${response.status}`,
      response.status
    );
  }

  let parsed: RawAuthorizeResponse;
  try {
    parsed = (await response.json()) as RawAuthorizeResponse;
  } catch {
    throw new StravaError(
      "unexpected",
      "Strava /oauth/token response was not valid JSON"
    );
  }

  if (
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
