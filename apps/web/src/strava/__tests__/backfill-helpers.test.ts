// Unit tests for apps/web/src/strava/backfill-helpers.ts
//
// All tests mock supabase-js and the DB helpers so no local Supabase is needed.
// The focus is on the normalization, sport-mapping, and rate-limit logic.

import { describe, expect, it, vi } from "vitest";

import {
  computeRateLimitBackoffMs,
  processActivityPage,
} from "@/strava/backfill-helpers";
import type { StravaActivity } from "@/strava/schemas";

// Mock the per-activity DB writers + matcher so processActivityPage can be
// exercised without a live Supabase. buildSummaryStats / normalizeSport stay
// real (pure functions).
const insertSpy = vi.fn(async () => "cw-id");
const hydrationSpy = vi.fn(async () => {});
const matchSpy = vi.fn(async () => {});

vi.mock("@/db/completed-workouts", () => ({
  insertOrUpdateStravaCompletedWorkout: (...args: unknown[]) => insertSpy(...args),
}));
vi.mock("@/db/strava-raw-payloads", () => ({
  insertHydrationPayload: (...args: unknown[]) => hydrationSpy(...args),
}));
vi.mock("@/strava/auto-match", () => ({
  matchStravaToPlanned: (...args: unknown[]) => matchSpy(...args),
}));

function fakeActivity(id: number): StravaActivity {
  return {
    id,
    name: `act-${id}`,
    sport_type: "Run",
    start_date: "2026-05-18T12:00:00Z",
    distance: 5000,
    moving_time: 1500,
  } as StravaActivity;
}

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

describe("processActivityPage", () => {
  const admin = {} as never;

  it("processes every activity and reports cumulative progress per batch", async () => {
    insertSpy.mockClear();
    const progress: number[] = [];
    const activities = Array.from({ length: 20 }, (_, i) => fakeActivity(i + 1));

    const count = await processActivityPage({
      admin,
      userId: "u1",
      activities,
      cap: 200,
      onProgress: (n) => {
        progress.push(n);
      },
    });

    expect(count).toBe(20);
    expect(insertSpy).toHaveBeenCalledTimes(20);
    // Bounded concurrency of 8 → batches of 8, 8, 4 → cumulative 8, 16, 20.
    expect(progress).toEqual([8, 16, 20]);
  });

  it("honors cap so total never exceeds the remaining budget", async () => {
    insertSpy.mockClear();
    const activities = Array.from({ length: 50 }, (_, i) => fakeActivity(i + 1));

    const count = await processActivityPage({
      admin,
      userId: "u1",
      activities,
      cap: 10,
    });

    expect(count).toBe(10);
    expect(insertSpy).toHaveBeenCalledTimes(10);
  });

  it("stops cleanly between batches when shouldStop flips", async () => {
    insertSpy.mockClear();
    const activities = Array.from({ length: 40 }, (_, i) => fakeActivity(i + 1));
    let calls = 0;

    const count = await processActivityPage({
      admin,
      userId: "u1",
      activities,
      cap: 200,
      // Stop after the first batch has been counted.
      shouldStop: () => calls++ >= 1,
    });

    // First batch (8) lands; second pre-batch check stops the loop.
    expect(count).toBe(8);
    expect(insertSpy).toHaveBeenCalledTimes(8);
  });

  it("treats a match failure as non-fatal", async () => {
    insertSpy.mockClear();
    matchSpy.mockRejectedValueOnce(new Error("match boom"));
    const activities = [fakeActivity(1), fakeActivity(2)];

    const count = await processActivityPage({
      admin,
      userId: "u1",
      activities,
      cap: 200,
    });

    expect(count).toBe(2);
    expect(insertSpy).toHaveBeenCalledTimes(2);
  });
});
