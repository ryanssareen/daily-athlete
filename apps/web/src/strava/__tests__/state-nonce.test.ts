// Tests for the server-signed state nonce. The nonce is the load-bearing
// CSRF defense for the Strava OAuth flow -- if these tests pass, an
// attacker who controls the /connect POST body still cannot forge a
// state without the server-side signing key.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // 32-byte hex; non-zero, non-placeholder.
  process.env.STRAVA_OAUTH_STATE_SIGNING_KEY =
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  process.env.STRAVA_TOKEN_KEYS =
    "1:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
});

import { signState, verifyState } from "../state-nonce";

describe("state-nonce", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips: signed state verifies for the same user", () => {
    const state = signState("user-1", 600);
    expect(verifyState("user-1", state)).toBe(true);
  });

  it("rejects state signed for a different user (HMAC bound to user_id)", () => {
    const state = signState("user-1", 600);
    expect(verifyState("user-2", state)).toBe(false);
  });

  it("rejects an expired state", () => {
    // Sign with a 1-second TTL, fast-forward 2 seconds.
    const start = new Date("2026-05-14T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const state = signState("user-1", 1);
    vi.setSystemTime(new Date(start.getTime() + 2_000));
    expect(verifyState("user-1", state)).toBe(false);
  });

  it("rejects a tampered HMAC (last char flipped)", () => {
    const state = signState("user-1", 600);
    const parts = state.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -1)}${
      parts[2]!.endsWith("0") ? "1" : "0"
    }`;
    expect(verifyState("user-1", tampered)).toBe(false);
  });

  it("rejects malformed states (wrong segment count)", () => {
    expect(verifyState("user-1", "no-dots-at-all")).toBe(false);
    expect(verifyState("user-1", "one.two")).toBe(false);
    expect(verifyState("user-1", "one.two.three.four")).toBe(false);
    expect(verifyState("user-1", "")).toBe(false);
  });

  it("rejects when expiresAt is non-integer", () => {
    expect(verifyState("user-1", "abc.notanumber.def")).toBe(false);
  });

  it("rejects different-length HMACs without leaking via early return", () => {
    // The constant-time path pads to max length and ALWAYS runs
    // timingSafeEqual, then checks lengths. A shorter forged HMAC must
    // still fail.
    const state = signState("user-1", 600);
    const parts = state.split(".");
    const truncated = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, 10)}`;
    expect(verifyState("user-1", truncated)).toBe(false);
  });
});
