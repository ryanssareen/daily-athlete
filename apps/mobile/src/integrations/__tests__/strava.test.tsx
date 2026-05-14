// Mock-based unit tests for the Strava connect screen's response-routing
// logic. The full React component test surface (rendering + reducer +
// promptAsync) requires a renderer that the mobile package doesn't ship
// today; per the Phase B plan we cover the pure transition logic here and
// defer the rest to manual QA on an EAS dev build.
//
// `postResponseToAction` is the seam: it deterministically maps a
// (status, body) pair from POST /api/integrations/strava/connect into the
// reducer action the UI dispatches. Asserting it covers the entire
// transition matrix without needing a mounted component.

import { describe, expect, it } from "vitest";

import { postResponseToAction, stravaConnectReducer } from "../strava-machine";

describe("postResponseToAction", () => {
  it("maps 200 + valid body to post_success with athlete_strava_id", () => {
    const action = postResponseToAction(200, {
      status: "connected",
      athlete_strava_id: 5005,
    });
    expect(action).toEqual({ type: "post_success", athleteStravaId: 5005 });
  });

  it("maps 200 + malformed body to post_4xx (caller can retry)", () => {
    const action = postResponseToAction(200, { status: "connected" });
    expect(action).toEqual({ type: "post_4xx", reason: "malformed_response" });
  });

  it("maps 409 to post_409 (account conflict)", () => {
    const action = postResponseToAction(409, {
      error: "strava_account_already_linked",
    });
    expect(action).toEqual({ type: "post_409" });
  });

  it("maps 5xx to post_5xx (network_error in the reducer)", () => {
    const action = postResponseToAction(502, { error: "strava_unreachable" });
    expect(action).toEqual({ type: "post_5xx" });
  });

  it("maps non-409 4xx to post_4xx with the error code as reason", () => {
    const action = postResponseToAction(400, { error: "state_mismatch" });
    expect(action).toEqual({ type: "post_4xx", reason: "state_mismatch" });
  });

  it("maps 400 with no body to post_4xx with undefined reason", () => {
    const action = postResponseToAction(400, null);
    expect(action).toEqual({ type: "post_4xx" });
  });
});

describe("stravaConnectReducer", () => {
  it("happy path: tap_connect -> oauth_returned_code -> post_success", () => {
    let state = stravaConnectReducer(
      { kind: "not_connected" },
      { type: "tap_connect" }
    );
    expect(state).toEqual({ kind: "opening" });
    state = stravaConnectReducer(state, { type: "oauth_returned_code" });
    expect(state).toEqual({ kind: "posting" });
    state = stravaConnectReducer(state, {
      type: "post_success",
      athleteStravaId: 42,
    });
    expect(state).toEqual({ kind: "connected", athleteStravaId: 42 });
  });

  it("oauth_cancelled returns to not_connected", () => {
    const state = stravaConnectReducer(
      { kind: "opening" },
      { type: "oauth_cancelled" }
    );
    expect(state).toEqual({ kind: "not_connected" });
  });

  it("409 routes to account_conflict; retry returns to not_connected", () => {
    let state = stravaConnectReducer({ kind: "posting" }, { type: "post_409" });
    expect(state).toEqual({ kind: "account_conflict" });
    state = stravaConnectReducer(state, { type: "retry" });
    expect(state).toEqual({ kind: "not_connected" });
  });

  it("5xx routes to network_error; retry returns to not_connected", () => {
    let state = stravaConnectReducer({ kind: "posting" }, { type: "post_5xx" });
    expect(state).toEqual({ kind: "network_error" });
    state = stravaConnectReducer(state, { type: "retry" });
    expect(state).toEqual({ kind: "not_connected" });
  });
});

