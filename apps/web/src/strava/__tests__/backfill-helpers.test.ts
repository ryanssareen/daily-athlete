// Unit tests for apps/web/src/strava/backfill-helpers.ts
//
// All tests mock supabase-js and the DB helpers so no local Supabase is needed.
// The focus is on the normalization, sport-mapping, and rate-limit logic.

import { describe, expect, it } from "vitest";

import { computeRateLimitBackoffMs } from "@/strava/backfill-helpers";

// Minimal fake Response for header testing
function makeResponse(headers: Record<string, string>, status = 200): Response {
  return new Response(null, { status, headers });
}

describe("computeRateLimitBackoffMs", () => {
  it("returns fallback 5 minutes when response is null", () => {
    const ms = computeRateLimitBackoffMs(null);
    expect(ms).toBe(5 * 60 * 1000);
  });

  it("returns fallback when rate-limit headers are missing", () => {
    const res = makeResponse({});
    expect(computeRateLimitBackoffMs(res)).toBe(5 * 60 * 1000);
  });

  it("returns fallback when not at the 15-min limit", () => {
    const res = makeResponse({
      "x-ratelimit-limit": "100,1000",
      "x-ratelimit-usage": "50,100",
    });
    expect(computeRateLimitBackoffMs(res)).toBe(5 * 60 * 1000);
  });

  it("returns next-window backoff when at the 15-min limit", () => {
    const res = makeResponse({
      "x-ratelimit-limit": "100,1000",
      "x-ratelimit-usage": "100,200",
    });
    const ms = computeRateLimitBackoffMs(res);
    // Should be between 5s (just rolled over) and 15m + 5s (worst case)
    expect(ms).toBeGreaterThanOrEqual(5000);
    expect(ms).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
  });

  it("handles malformed usage header gracefully", () => {
    const res = makeResponse({ "x-ratelimit-usage": "not-a-number" });
    expect(computeRateLimitBackoffMs(res)).toBe(5 * 60 * 1000);
  });
});

// Test sport normalization indirectly via backfill-helpers
import { normalizeSport } from "@/strava/sport-normalization";

describe("normalizeSport (via sport-normalization)", () => {
  it("maps known Strava sport types", () => {
    expect(normalizeSport("Run")).toBe("run");
    expect(normalizeSport("Ride")).toBe("bike");
    expect(normalizeSport("Swim")).toBe("swim");
    expect(normalizeSport("WeightTraining")).toBe("strength");
    expect(normalizeSport("Yoga")).toBe("mobility");
  });

  it("maps unknown sport type to 'other'", () => {
    expect(normalizeSport("Pickleball")).toBe("other");
    expect(normalizeSport("")).toBe("other");
    expect(normalizeSport("__proto__")).toBe("other");
  });
});
