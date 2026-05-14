// Wire contract for POST /api/integrations/strava/init and
// POST /api/integrations/strava/connect.
//
// Flow:
// 1. Mobile POSTs to `/api/integrations/strava/init` (empty body). The
//    server signs a state nonce keyed to the authenticated user and
//    returns it. The signing key (`STRAVA_OAUTH_STATE_SIGNING_KEY`) lives
//    only on the server, so the mobile client cannot mint its own.
// 2. Mobile uses that signed `state` as the OAuth state parameter when
//    opening Strava's authorize page; expo-auth-session passes it through.
// 3. After Strava redirects back, mobile POSTs `/connect` with
//    `{ code, code_verifier, redirect_uri, state }`. The server
//    HMAC-verifies the state against the signing key + user_id + expiry.
//    Mismatch -> 400 `state_mismatch`. Both `expected_state` and the
//    timingSafeEqual on attacker-controlled inputs are gone -- the
//    signing key is the server-side ground truth.
//
// Sensitive fields (`code`, `code_verifier`) MUST NOT appear in logs --
// the route handler's logging policy enforces this; this schema is just
// the shape contract.

import { z } from "zod";

export const StravaInitResponseSchema = z.object({
  // Server-signed state nonce: <nonce>.<expiresAt>.<hmacHex>. Opaque to
  // the client; the server verifies on /connect.
  state: z.string().min(1),
});
export type StravaInitResponse = z.infer<typeof StravaInitResponseSchema>;

export const StravaConnectRequestSchema = z.object({
  // Authorization code returned by Strava on the OAuth callback. Single-use.
  code: z.string().min(1, "code is required"),
  // PKCE verifier the mobile client generated. The server forwards this
  // alongside `code` to Strava's /oauth/token; Strava verifies the SHA256.
  code_verifier: z.string().min(1, "code_verifier is required"),
  // The exact redirect_uri used in the original authorize request. Must
  // be one of the values registered with the Strava developer app.
  redirect_uri: z.string().url(),
  // Server-signed state nonce echoed back from Strava. The server
  // HMAC-verifies this against its signing key + the authenticated user_id.
  // No `expected_state` field -- both sides of the comparison must not
  // come from the same attacker-controlled body.
  state: z.string().min(1, "state is required"),
});
export type StravaConnectRequest = z.infer<typeof StravaConnectRequestSchema>;

export const StravaConnectResponseSchema = z.object({
  status: z.literal("connected"),
  athlete_strava_id: z.number().int().positive(),
});
export type StravaConnectResponse = z.infer<typeof StravaConnectResponseSchema>;

// Normalized error codes the route emits. Strava's raw response body is
// never echoed -- callers (mobile UI) branch on these codes.
//
// `strava_rejected_code` covers both an expired/replayed authorization
// code AND a PKCE verification failure. The only recovery is a fresh
// authorize round trip (new code + new verifier). Mobile state machine
// surfaces this as `auth_error`.
export const StravaConnectErrorCodeSchema = z.enum([
  "state_mismatch",
  "invalid_input",
  "strava_account_already_linked",
  "strava_rejected_code",
  "strava_unreachable",
  "internal_error",
  "unauthorized",
]);
export type StravaConnectErrorCode = z.infer<
  typeof StravaConnectErrorCodeSchema
>;

export const StravaConnectErrorResponseSchema = z.object({
  error: StravaConnectErrorCodeSchema,
  // Optional human-readable message. Never includes the raw Strava body.
  message: z.string().optional(),
});
export type StravaConnectErrorResponse = z.infer<
  typeof StravaConnectErrorResponseSchema
>;
