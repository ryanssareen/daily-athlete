// Shared Strava endpoint URLs. Centralised so oauth.ts (initial code
// exchange) and client.ts (per-user refresh) use the same canonical
// values -- if Strava ever migrates the host, there is one place to edit.

export const STRAVA_API_BASE = "https://www.strava.com/api/v3";
export const STRAVA_OAUTH_TOKEN_URL = "https://www.strava.com/oauth/token";

// Outbound HTTP deadlines. AGENTS.md "Tooling for agents" doesn't allow
// us to swallow network errors with `|| true`; the client must time out
// cleanly so the caller can surface a typed StravaError('network', ...).
//
// /oauth/token: 8s — token-exchange is short, low payload; protects the
// HTTP route handler's Vercel function deadline.
// /api/v3/*: 30s — backfill payloads are larger and Strava can be slow
// during peak hours; the Inngest step deadline absorbs the rest.
export const STRAVA_OAUTH_FETCH_TIMEOUT_MS = 8_000;
export const STRAVA_API_FETCH_TIMEOUT_MS = 30_000;
