// Drives the REAL reconcile orchestration (apps/web/src/strava/reconcile.ts).
// The Strava client, the completed-workout upsert, and the token listing are
// faked so no live Supabase/Strava is needed; the functions under test are the
// shipped ones. Focus: reconcile inserts ONLY the activities missing locally,
// fails soft per-user, and the sweep never silently drops users.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fakeFetch, processActivityPage } = vi.hoisted(() => ({
  fakeFetch: vi.fn(),
  processActivityPage: vi.fn(),
}));

vi.mock("@/strava/client", () => ({
  createStravaClient: () => ({
    fetch: fakeFetch,
    touchLastUsed: vi.fn(async () => {}),
    rateLimits: { fifteenMin: null, daily: null },
  }),
}));

vi.mock("@/strava/backfill-helpers", () => ({ processActivityPage }));

import {
  reconcileAllStravaUsers,
  reconcileStravaForUser,
} from "@/strava/reconcile";
import { StravaRateLimited, StravaReauthRequired } from "@/strava/errors";

const USER = "11111111-1111-1111-1111-111111111111";
const NOW = 1_700_000_000_000;

function activities(ids: number[]): unknown[] {
  return ids.map((id) => ({
    id,
    name: `act-${id}`,
    sport_type: "Run",
    start_date: "2026-06-30T12:00:00Z",
    distance: 5000,
    moving_time: 1500,
  }));
}

function okPage(ids: number[]): Response {
  return new Response(JSON.stringify(activities(ids)), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Minimal thenable supabase-js fake. `.from(table)` yields a chain whose
 * awaited value is `results[table]`. Covers completed_workouts
 * (.select().eq().in()) and strava_tokens (.select()).
 */
function makeAdmin(results: Record<string, { data: unknown; error: unknown }>) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in"]) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve);
      return chain;
    },
  } as never;
}

beforeEach(() => {
  fakeFetch.mockReset();
  processActivityPage.mockReset();
  // Default: the helper reports it persisted every activity handed to it.
  processActivityPage.mockImplementation(
    async ({ activities: a }: { activities: unknown[] }) => a.length
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reconcileStravaForUser", () => {
  it("inserts only the activities missing locally", async () => {
    fakeFetch.mockResolvedValueOnce(okPage([1, 2, 3]));
    // Activity 2 already stored → only 1 and 3 should be recovered.
    const admin = makeAdmin({
      completed_workouts: { data: [{ strava_activity_id: 2 }], error: null },
    });

    const result = await reconcileStravaForUser(admin, USER, { nowMs: NOW });

    expect(result).toEqual({
      userId: USER,
      fetched: 3,
      recovered: 2,
      ok: true,
    });
    const passed = processActivityPage.mock.calls[0]![0] as {
      activities: Array<{ id: number }>;
    };
    expect(passed.activities.map((a) => a.id)).toEqual([1, 3]);
  });

  it("does not resurrect a soft-deleted activity (present id is skipped)", async () => {
    fakeFetch.mockResolvedValueOnce(okPage([1, 2]));
    // Both ids already have rows (fetchExistingActivityIds does not filter
    // deleted_at), so nothing is re-inserted.
    const admin = makeAdmin({
      completed_workouts: {
        data: [{ strava_activity_id: 1 }, { strava_activity_id: 2 }],
        error: null,
      },
    });

    const result = await reconcileStravaForUser(admin, USER, { nowMs: NOW });

    expect(result.recovered).toBe(0);
    expect(processActivityPage).not.toHaveBeenCalled();
  });

  it("requests activities after the lookback window (after= epoch)", async () => {
    fakeFetch.mockResolvedValueOnce(okPage([]));
    await reconcileStravaForUser(admin(), USER, {
      nowMs: NOW,
      lookbackMs: 14 * 24 * 60 * 60 * 1000,
    });
    const url = fakeFetch.mock.calls[0]![0] as string;
    const expectedAfter = Math.floor((NOW - 14 * 24 * 60 * 60 * 1000) / 1000);
    expect(url).toContain(`after=${expectedAfter}`);
  });

  it("empty window → recovered 0, ok true, no writes", async () => {
    fakeFetch.mockResolvedValueOnce(okPage([]));
    const result = await reconcileStravaForUser(admin(), USER, { nowMs: NOW });
    expect(result).toEqual({ userId: USER, fetched: 0, recovered: 0, ok: true });
    expect(processActivityPage).not.toHaveBeenCalled();
  });

  it("returns needs_reauth when the client throws StravaReauthRequired", async () => {
    fakeFetch.mockRejectedValueOnce(new StravaReauthRequired());
    const result = await reconcileStravaForUser(admin(), USER, { nowMs: NOW });
    expect(result).toMatchObject({ ok: false, errorCode: "needs_reauth" });
    expect(processActivityPage).not.toHaveBeenCalled();
  });

  it("maps a 429 to rate_limited without treating it as data", async () => {
    fakeFetch.mockResolvedValueOnce(new Response("", { status: 429 }));
    const result = await reconcileStravaForUser(admin(), USER, { nowMs: NOW });
    expect(result).toMatchObject({ ok: false, errorCode: "rate_limited" });
  });

  it("treats 403 Application Inactive as a failed user (errorCode unknown)", async () => {
    fakeFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ errors: [{ resource: "Application", code: "Inactive" }] }),
        { status: 403 }
      )
    );
    const result = await reconcileStravaForUser(admin(), USER, { nowMs: NOW });
    expect(result).toMatchObject({ ok: false, errorCode: "unknown", fetched: 0 });
  });

  it("propagates StravaRateLimited thrown by the client as rate_limited", async () => {
    fakeFetch.mockRejectedValueOnce(new StravaRateLimited("quota"));
    const result = await reconcileStravaForUser(admin(), USER, { nowMs: NOW });
    expect(result).toMatchObject({ ok: false, errorCode: "rate_limited" });
  });
});

describe("reconcileAllStravaUsers", () => {
  it("reconciles every connected athlete and sums what was recovered", async () => {
    const admin = makeAdmin({
      strava_tokens: { data: [{ user_id: "u1" }, { user_id: "u2" }], error: null },
      completed_workouts: { data: [], error: null }, // nothing stored → all missing
    });
    // Fresh Response per call — a Response body can only be read once.
    fakeFetch.mockImplementation(async () => okPage([10, 11]));

    const sweep = await reconcileAllStravaUsers(admin, { nowMs: NOW });

    expect(sweep.processed).toBe(2);
    expect(sweep.recovered).toBe(4); // 2 users × 2 recovered
    expect(sweep.failed).toBe(0);
    expect(sweep.skipped).toBe(0);
  });

  it("reports users not reached before the deadline as skipped (never silent)", async () => {
    const admin = makeAdmin({
      strava_tokens: {
        data: [{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u3" }],
        error: null,
      },
      completed_workouts: { data: [], error: null },
    });
    // deadlineMs 0 → the sweep loop never starts a batch; all users deferred.
    const sweep = await reconcileAllStravaUsers(admin, {
      nowMs: NOW - 1,
      deadlineMs: 0,
    });
    expect(sweep.processed).toBe(0);
    expect(sweep.skipped).toBe(3);
  });

  it("one athlete's failure does not abort the sweep", async () => {
    const admin = makeAdmin({
      strava_tokens: { data: [{ user_id: "u1" }, { user_id: "u2" }], error: null },
      completed_workouts: { data: [], error: null },
    });
    fakeFetch
      .mockRejectedValueOnce(new StravaReauthRequired()) // u1 fails
      .mockResolvedValueOnce(okPage([20])); // u2 succeeds

    const sweep = await reconcileAllStravaUsers(admin, { nowMs: NOW });

    expect(sweep.processed).toBe(2);
    expect(sweep.failed).toBe(1);
    expect(sweep.recovered).toBe(1);
  });
});

// Convenience: an admin whose completed_workouts + strava_tokens both read empty.
function admin() {
  return makeAdmin({
    completed_workouts: { data: [], error: null },
    strava_tokens: { data: [], error: null },
  });
}
