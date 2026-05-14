// Pure state-machine + response-routing for the Strava connect screen.
//
// Extracted from the React component so unit tests can import this module
// without dragging in expo-auth-session, React Native, or expo-constants
// (none of which load cleanly in a Node test environment).

import {
  StravaConnectErrorResponseSchema,
  StravaConnectResponseSchema,
} from "@da2/shared";

export type StravaConnectState =
  | { kind: "not_connected" }
  | { kind: "opening" }
  | { kind: "posting" }
  | { kind: "connected"; athleteStravaId: number }
  | { kind: "account_conflict" }
  | { kind: "network_error" }
  | { kind: "auth_error"; reason?: string }
  | { kind: "needs_reauth" };

export type StravaConnectAction =
  | { type: "tap_connect" }
  | { type: "oauth_cancelled" }
  | { type: "oauth_returned_code" }
  | { type: "post_success"; athleteStravaId: number }
  | { type: "post_409" }
  | { type: "post_4xx"; reason?: string }
  | { type: "post_5xx" }
  | { type: "retry" }
  // Phase C2: dispatched externally when the backfill realtime channel
  // signals `backfill_status.state = 'needs_reauth'`. Today there is no
  // production dispatcher; the UI branch in strava.tsx renders the
  // "Reconnect Strava" affordance when this state is reached.
  | { type: "set_needs_reauth" };

export function stravaConnectReducer(
  state: StravaConnectState,
  action: StravaConnectAction
): StravaConnectState {
  switch (action.type) {
    case "tap_connect":
      return { kind: "opening" };
    case "oauth_cancelled":
      return { kind: "not_connected" };
    case "oauth_returned_code":
      return { kind: "posting" };
    case "post_success":
      return { kind: "connected", athleteStravaId: action.athleteStravaId };
    case "post_409":
      return { kind: "account_conflict" };
    case "post_4xx":
      return { kind: "auth_error", reason: action.reason };
    case "post_5xx":
      return { kind: "network_error" };
    case "retry":
      return { kind: "not_connected" };
    case "set_needs_reauth":
      return { kind: "needs_reauth" };
  }
}

/**
 * Map a (status, body) pair from POST /api/integrations/strava/connect
 * to the reducer action the UI should dispatch.
 *
 * Validates the body against the shared Zod schemas
 * (StravaConnectResponseSchema, StravaConnectErrorResponseSchema) so a
 * server-side contract drift surfaces as `malformed_response` rather
 * than a duck-typed undefined-property read.
 *
 * Status mapping:
 *   - 200 / 202 (success): the route returns 202 Accepted after enqueuing
 *     the backfill; 200 retained for forward compat / legacy.
 *   - 409: account conflict (different DA2 user owns this Strava account).
 *   - 4xx (non-409): auth_error, with the parsed `error` code as `reason`.
 *   - 5xx: network_error.
 */
export function postResponseToAction(
  status: number,
  body: unknown
): StravaConnectAction {
  if (status === 200 || status === 202) {
    const parsed = StravaConnectResponseSchema.safeParse(body);
    if (parsed.success) {
      return {
        type: "post_success",
        athleteStravaId: parsed.data.athlete_strava_id,
      };
    }
    return { type: "post_4xx", reason: "malformed_response" };
  }
  if (status === 409) return { type: "post_409" };
  if (status >= 500) return { type: "post_5xx" };
  if (status >= 400) {
    const parsed = StravaConnectErrorResponseSchema.safeParse(body);
    if (parsed.success) {
      return { type: "post_4xx", reason: parsed.data.error };
    }
    return { type: "post_4xx", reason: "malformed_response" };
  }
  return { type: "post_4xx" };
}
