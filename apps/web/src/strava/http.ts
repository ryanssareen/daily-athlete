// Shared fetch boilerplate for Strava's /oauth/token endpoint.
//
// Both the initial authorization-code exchange (oauth.ts) and the
// refresh-token rotation (client.ts) post application/x-www-form-urlencoded
// payloads to the same URL and follow the same error-translation rules:
//
//   - network failure -> StravaError('network', ...)
//   - 400/401 -> caller decides (invalid_grant vs invalid code mean
//     different things in the two contexts; we surface the status so the
//     caller can throw the right typed error)
//   - other non-ok -> StravaError('unexpected', ..., status)
//   - JSON parse failure -> StravaError('unexpected', ...)
//
// Keeping this in one place means a bug in error-message templating
// (e.g. accidentally including the raw response body) gets fixed once.

import { StravaError } from "./errors";
import {
  STRAVA_OAUTH_FETCH_TIMEOUT_MS,
  STRAVA_OAUTH_TOKEN_URL,
} from "./constants";

export interface OauthTokenFetchResult {
  /** HTTP status code. Caller branches on 400/401 vs other failures. */
  status: number;
  /** True iff `response.ok` was true. */
  ok: boolean;
  /** JSON-parsed body. Caller validates shape; this layer doesn't. */
  body: unknown;
}

/**
 * POST to https://www.strava.com/oauth/token with the given form body.
 *
 * - Adds an AbortSignal.timeout(STRAVA_OAUTH_FETCH_TIMEOUT_MS) so a slow
 *   Strava deployment doesn't hang the Vercel function past its deadline.
 * - Wraps fetch failures (AbortError, DNS, TCP) as StravaError('network').
 * - Wraps JSON parse failures as StravaError('unexpected').
 *
 * 400 / 401 are returned (status + body) for the caller to interpret:
 *   oauth.ts: 400 -> StravaReauthRequired('Strava rejected the code')
 *   client.ts: 400 OR 401 -> StravaReauthRequired (invalid_grant)
 */
export async function postStravaOauthForm(
  body: URLSearchParams
): Promise<OauthTokenFetchResult> {
  let response: Response;
  try {
    response = await fetch(STRAVA_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(STRAVA_OAUTH_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new StravaError(
      "network",
      `Strava /oauth/token unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 400/401 carry meaningful JSON bodies (Strava encodes invalid_grant in
  // the body). For ok and other non-ok statuses we still parse JSON --
  // ok responses contain the token pair, and a non-ok unexpected response
  // is wrapped by the caller without exposing the body.
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    // Some Strava error responses are not JSON (e.g. plain-text 502).
    // Caller treats null body as opaque; the status alone drives the
    // error code.
    parsed = null;
  }

  if (response.ok || response.status === 400 || response.status === 401) {
    return { status: response.status, ok: response.ok, body: parsed };
  }

  throw new StravaError(
    "unexpected",
    `Strava /oauth/token returned ${response.status}`,
    response.status
  );
}
