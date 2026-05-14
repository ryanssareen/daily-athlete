// Pure state-machine + response-routing for the Strava connect screen.
//
// Extracted from the React component so unit tests can import this module
// without dragging in expo-auth-session, React Native, or expo-constants
// (none of which load cleanly in a Node test environment).

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
 */
export function postResponseToAction(
  status: number,
  body: unknown
): StravaConnectAction {
  if (status === 200 && body && typeof body === "object") {
    const athleteId = (body as { athlete_strava_id?: number }).athlete_strava_id;
    if (typeof athleteId === "number") {
      return { type: "post_success", athleteStravaId: athleteId };
    }
    return { type: "post_4xx", reason: "malformed_response" };
  }
  if (status === 409) return { type: "post_409" };
  if (status >= 500) return { type: "post_5xx" };
  if (status >= 400) {
    const reason =
      body && typeof body === "object"
        ? (body as { error?: string }).error
        : undefined;
    return { type: "post_4xx", reason };
  }
  return { type: "post_4xx" };
}
