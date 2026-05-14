import { describe, expect, it } from "vitest";

import {
  StravaConnectErrorCodeSchema,
  StravaConnectErrorResponseSchema,
  StravaConnectRequestSchema,
  StravaConnectResponseSchema,
} from "../strava-connect";

describe("StravaConnectRequestSchema", () => {
  it("accepts a complete valid request body", () => {
    const result = StravaConnectRequestSchema.safeParse({
      code: "auth-code-1",
      code_verifier: "verifier-1",
      redirect_uri: "https://example.com/cb",
      state: "state-1",
      expected_state: "state-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing PKCE verifier (cannot exchange without it)", () => {
    const result = StravaConnectRequestSchema.safeParse({
      code: "x",
      redirect_uri: "https://example.com/cb",
      state: "s",
      expected_state: "s",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing expected_state (state validation impossible)", () => {
    const result = StravaConnectRequestSchema.safeParse({
      code: "x",
      code_verifier: "v",
      redirect_uri: "https://example.com/cb",
      state: "s",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty code string (single-use Strava code cannot be empty)", () => {
    const result = StravaConnectRequestSchema.safeParse({
      code: "",
      code_verifier: "v",
      redirect_uri: "https://example.com/cb",
      state: "s",
      expected_state: "s",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-URL redirect_uri", () => {
    const result = StravaConnectRequestSchema.safeParse({
      code: "c",
      code_verifier: "v",
      redirect_uri: "not-a-uri",
      state: "s",
      expected_state: "s",
    });
    expect(result.success).toBe(false);
  });
});

describe("StravaConnectResponseSchema", () => {
  it("accepts a minimal success payload", () => {
    const result = StravaConnectResponseSchema.safeParse({
      status: "connected",
      athlete_strava_id: 42,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-positive athlete ids", () => {
    const result = StravaConnectResponseSchema.safeParse({
      status: "connected",
      athlete_strava_id: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe("StravaConnectErrorCodeSchema", () => {
  it.each([
    "state_mismatch",
    "invalid_input",
    "strava_account_already_linked",
    "strava_rejected_code",
    "strava_unreachable",
    "internal_error",
    "unauthorized",
  ] as const)("accepts %s", (code) => {
    expect(StravaConnectErrorCodeSchema.safeParse(code).success).toBe(true);
  });

  it("rejects unknown codes (prevents accidental error-code drift)", () => {
    expect(
      StravaConnectErrorCodeSchema.safeParse("something_else").success
    ).toBe(false);
  });
});

describe("StravaConnectErrorResponseSchema", () => {
  it("accepts code-only payload", () => {
    const result = StravaConnectErrorResponseSchema.safeParse({
      error: "state_mismatch",
    });
    expect(result.success).toBe(true);
  });
  it("accepts code + message payload", () => {
    const result = StravaConnectErrorResponseSchema.safeParse({
      error: "strava_account_already_linked",
      message: "This Strava account is linked to another DA2 user.",
    });
    expect(result.success).toBe(true);
  });
});
