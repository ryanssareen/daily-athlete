import { describe, expect, it } from "vitest";

import { StravaError, StravaRateLimited } from "@/strava/errors";
import { isRetryableFailure, isRetryableReason } from "@/strava/hydrate-workout";

// #103 follow-up. `hydrated_at` is withheld for retryable enrichment
// failures so the row is hydrated again later. Misclassifying a settled 4xx
// as retryable therefore does not just mislabel it — it makes every
// workout-detail render re-hit Strava forever for an activity that can
// never produce zones.
describe("isRetryableReason", () => {
  it("retries rate limits", () => {
    expect(isRetryableReason(new StravaRateLimited("slow down", 60))).toBe(true);
  });

  it("retries network errors", () => {
    expect(isRetryableReason(new StravaError("network", "socket hang up"))).toBe(true);
  });

  it("retries 5xx", () => {
    expect(isRetryableReason(new StravaError("unexpected", "boom", 502))).toBe(true);
  });

  it("does NOT retry a subscription-gated 403", () => {
    expect(isRetryableReason(new StravaError("unexpected", "forbidden", 403))).toBe(false);
  });

  it("does NOT retry other 4xx", () => {
    expect(isRetryableReason(new StravaError("unexpected", "bad request", 400))).toBe(false);
    expect(isRetryableReason(new StravaError("unexpected", "conflict", 409))).toBe(false);
  });

  it("retries a StravaError carrying no status", () => {
    expect(isRetryableReason(new StravaError("unexpected", "no status"))).toBe(true);
  });

  it("retries unclassified non-Strava throws", () => {
    expect(isRetryableReason(new Error("aborted"))).toBe(true);
    expect(isRetryableReason("nope")).toBe(true);
  });
});

describe("isRetryableFailure", () => {
  it("is false for a fulfilled result regardless of value", () => {
    expect(isRetryableFailure({ status: "fulfilled", value: null })).toBe(false);
    expect(isRetryableFailure({ status: "fulfilled", value: [] })).toBe(false);
  });

  it("is false for a rejection Strava settled with a 4xx", () => {
    expect(
      isRetryableFailure({
        status: "rejected",
        reason: new StravaError("unexpected", "forbidden", 403),
      })
    ).toBe(false);
  });

  it("is true for a rejection worth retrying", () => {
    expect(
      isRetryableFailure({
        status: "rejected",
        reason: new StravaError("unexpected", "gateway", 503),
      })
    ).toBe(true);
  });
});
