// Zod tests for the Strava Phase C contracts: the column shape, the closed
// error-code enum, and the retry-endpoint envelopes. The DB-level CHECK
// constraint in migration 0009 is tested separately in
// apps/web/src/db/__tests__/athlete-profile-backfill-status.test.ts.

import { describe, expect, it } from "vitest";

import {
  BackfillStatusColumnSchema,
  StravaBackfillErrorCodeSchema,
  StravaBackfillRetryErrorCodeSchema,
  StravaBackfillRetryErrorResponseSchema,
  StravaBackfillRetryResponseSchema,
} from "../strava-backfill";

describe("BackfillStatusColumnSchema", () => {
  it("parses the empty default {} as state: undefined", () => {
    const parsed = BackfillStatusColumnSchema.parse({});
    expect(parsed.state).toBeUndefined();
    expect(parsed.provider).toBeUndefined();
  });

  it("accepts a queued status", () => {
    const parsed = BackfillStatusColumnSchema.parse({
      provider: "strava",
      state: "queued",
    });
    expect(parsed.state).toBe("queued");
    expect(parsed.provider).toBe("strava");
  });

  it("accepts an in_progress status with counts", () => {
    const parsed = BackfillStatusColumnSchema.parse({
      provider: "strava",
      state: "in_progress",
      completed: 142,
      estimatedTotal: 200,
      started_at: "2026-05-16T10:30:00+00:00",
    });
    expect(parsed.completed).toBe(142);
    expect(parsed.estimatedTotal).toBe(200);
    expect(parsed.started_at).toBe("2026-05-16T10:30:00+00:00");
  });

  it("accepts a complete status", () => {
    const parsed = BackfillStatusColumnSchema.parse({
      provider: "strava",
      state: "complete",
      completed: 200,
      estimatedTotal: 200,
      started_at: "2026-05-16T10:30:00+00:00",
      completed_at: "2026-05-16T10:33:21+00:00",
    });
    expect(parsed.state).toBe("complete");
    expect(parsed.completed_at).toBe("2026-05-16T10:33:21+00:00");
  });

  it("accepts a failed status with a closed error_code", () => {
    const parsed = BackfillStatusColumnSchema.parse({
      provider: "strava",
      state: "failed",
      error_code: "max_retries_exhausted",
      attempt: 5,
    });
    expect(parsed.error_code).toBe("max_retries_exhausted");
    expect(parsed.attempt).toBe(5);
  });

  it("accepts a needs_reauth status", () => {
    const parsed = BackfillStatusColumnSchema.parse({
      provider: "strava",
      state: "needs_reauth",
      error_code: "needs_reauth",
    });
    expect(parsed.state).toBe("needs_reauth");
  });

  it("rejects unknown state values", () => {
    expect(() =>
      BackfillStatusColumnSchema.parse({ provider: "strava", state: "bogus" }),
    ).toThrow();
  });

  it("rejects arbitrary strings for error_code (closed enum)", () => {
    expect(() =>
      BackfillStatusColumnSchema.parse({
        provider: "strava",
        state: "failed",
        // This is exactly the leak we close: a raw err.message string must
        // never be writable into the column / served back to the device.
        error_code: "Bearer 5f2e8a... <redacted token bytes>",
      }),
    ).toThrow();
  });

  it("rejects negative completed counts", () => {
    expect(() =>
      BackfillStatusColumnSchema.parse({
        provider: "strava",
        state: "in_progress",
        completed: -1,
      }),
    ).toThrow();
  });

  it("rejects non-integer attempt counts", () => {
    expect(() =>
      BackfillStatusColumnSchema.parse({
        provider: "strava",
        state: "failed",
        attempt: 2.5,
      }),
    ).toThrow();
  });

  it("rejects unexpected top-level keys (strict mode)", () => {
    expect(() =>
      BackfillStatusColumnSchema.parse({
        provider: "strava",
        state: "queued",
        unexpected_field: "anything",
      }),
    ).toThrow();
  });

  it("rejects a non-strava provider (single-provider invariant)", () => {
    expect(() =>
      BackfillStatusColumnSchema.parse({
        provider: "garmin",
        state: "queued",
      }),
    ).toThrow();
  });

  it("rejects timestamps without an offset (matches CONVENTION across shared/)", () => {
    // Bare-Z timestamps would parse with .datetime() but PostgREST returns
    // offset notation; we standardize on .datetime({ offset: true }).
    expect(() =>
      BackfillStatusColumnSchema.parse({
        provider: "strava",
        state: "in_progress",
        started_at: "not-a-timestamp",
      }),
    ).toThrow();
  });
});

describe("StravaBackfillErrorCodeSchema", () => {
  it.each([
    "needs_reauth",
    "rate_limited",
    "key_rotation",
    "max_retries_exhausted",
    "watchdog_demoted",
    "enqueue_failed",
    "network",
    "corrupt_state",
    "unknown",
  ])("accepts the documented code %s", (code) => {
    expect(StravaBackfillErrorCodeSchema.parse(code)).toBe(code);
  });

  it("rejects undocumented codes", () => {
    expect(() => StravaBackfillErrorCodeSchema.parse("Bearer abc...")).toThrow();
    expect(() => StravaBackfillErrorCodeSchema.parse("")).toThrow();
  });
});

describe("StravaBackfillRetryErrorCodeSchema", () => {
  it.each([
    "unauthorized",
    "no_strava_connection",
    "already_in_progress",
    "needs_reconnect",
    "enqueue_failed",
    "internal_error",
  ])("accepts the documented retry-endpoint code %s", (code) => {
    expect(StravaBackfillRetryErrorCodeSchema.parse(code)).toBe(code);
  });

  it("rejects undocumented retry-endpoint codes", () => {
    expect(() => StravaBackfillRetryErrorCodeSchema.parse("unknown_code")).toThrow();
  });
});

describe("StravaBackfillRetryResponseSchema", () => {
  it("requires the queued literal and a snapshot", () => {
    const parsed = StravaBackfillRetryResponseSchema.parse({
      status: "queued",
      backfill_status: { provider: "strava", state: "queued" },
    });
    expect(parsed.status).toBe("queued");
    expect(parsed.backfill_status.state).toBe("queued");
  });

  it("rejects a status other than queued", () => {
    expect(() =>
      StravaBackfillRetryResponseSchema.parse({
        status: "complete",
        backfill_status: { provider: "strava", state: "complete" },
      }),
    ).toThrow();
  });
});

describe("StravaBackfillRetryErrorResponseSchema", () => {
  it("requires a documented error code", () => {
    const parsed = StravaBackfillRetryErrorResponseSchema.parse({
      error: "already_in_progress",
    });
    expect(parsed.error).toBe("already_in_progress");
  });

  it("rejects arbitrary error strings", () => {
    expect(() =>
      StravaBackfillRetryErrorResponseSchema.parse({ error: "made_up" }),
    ).toThrow();
  });
});
