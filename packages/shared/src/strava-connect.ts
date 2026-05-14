// Wire contract for POST /api/integrations/strava/connect.
//
// The mobile client (apps/mobile/src/integrations/strava.tsx) sends the
// authorization code + PKCE verifier + state nonce after expo-auth-session
// returns from Strava's authorize page. The server validates state, then
// exchanges the code+verifier with Strava's /oauth/token endpoint.
//
// Why state is on the body (not a cookie):
// - Mobile OAuth runs over the device's browser/in-app-browser, not the
//   Next.js cookie jar. The mobile client persists the state it generated
//   between auth-request and POST and passes it explicitly so the server
//   can verify it matches what the mobile session presented as
//   `expected_state`.
//
// Sensitive fields (`code`, `code_verifier`) MUST NOT appear in logs --
// the route handler's logging policy enforces this; this schema is just
// the shape contract.

import { z } from "zod";

export const StravaConnectRequestSchema = z.object({
  // Authorization code returned by Strava on the OAuth callback. Single-use.
  code: z.string().min(1, "code is required"),
  // PKCE verifier the mobile client generated. The server forwards this
  // alongside `code` to Strava's /oauth/token; Strava verifies the SHA256.
  code_verifier: z.string().min(1, "code_verifier is required"),
  // The exact redirect_uri used in the original authorize request. Must
  // be one of the values registered with the Strava developer app.
  redirect_uri: z.string().url(),
  // OAuth state nonce. The mobile client generated it, presented it to
  // Strava, and Strava echoed it back; the server compares against
  // `expected_state` (the value the mobile session captured before the
  // authorize hop).
  state: z.string().min(1, "state is required"),
  // The state value the mobile session originally generated. Server
  // compares state === expected_state. Mismatch -> 400 (CSRF protection).
  expected_state: z.string().min(1, "expected_state is required"),
});
export type StravaConnectRequest = z.infer<typeof StravaConnectRequestSchema>;

export const StravaConnectResponseSchema = z.object({
  status: z.literal("connected"),
  athlete_strava_id: z.number().int().positive(),
});
export type StravaConnectResponse = z.infer<typeof StravaConnectResponseSchema>;

// Normalized error codes the route emits. Strava's raw response body is
// never echoed -- callers (mobile UI) branch on these codes.
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
