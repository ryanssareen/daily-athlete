// Integration-style test that drives the REAL runBackfillForUser orchestration
// (apps/web/src/strava/run-backfill.ts) through the three scenarios that the
// production fix targets:
//   1. normal run  → progress is written incrementally, then `complete`
//   2. slow run    → hits the ~50s soft deadline and exits with a REAL
//                    `failed/timed_out` + the partial `completed` count
//                    (instead of being hard-killed at `in_progress / 0`)
//   3. failed run  → persists the ACTUAL error message in `error_detail`
//
// The Strava client + DB writers are faked so no live Supabase/Strava is
// needed; the function under test is the real shipped one.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { statusWrites, helperMocks, fakeFetch } = vi.hoisted(() => ({
  statusWrites: [] as Array<Record<string, unknown>>,
  helperMocks: {
    userExists: vi.fn(async () => true),
    markBackfillComplete: vi.fn(async () => {}),
    processActivityPage: vi.fn(),
    computeRateLimitBackoffMs: vi.fn(() => 5 * 60 * 1000),
  },
  fakeFetch: vi.fn(),
}));

vi.mock("@/db/admin", () => ({ createAdminClient: () => ({}) }));

vi.mock("@/db/backfill-status", () => ({
  updateBackfillStatus: vi.fn(async (_admin: unknown, _userId: string, status) => {
    statusWrites.push(status as Record<string, unknown>);
  }),
}));

vi.mock("@/strava/client", () => ({
  createStravaClient: () => ({
    fetch: fakeFetch,
    touchLastUsed: vi.fn(async () => {}),
    rateLimits: { fifteenMin: null, daily: null },
  }),
}));

vi.mock("@/strava/backfill-helpers", () => helperMocks);

import { runBackfillForUser } from "@/strava/run-backfill";

function activities(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `act-${i + 1}`,
    sport_type: "Run",
    start_date: "2026-05-18T12:00:00Z",
    distance: 5000,
    moving_time: 1500,
  }));
}

function okPage(n: number): Response {
  return new Response(JSON.stringify(activities(n)), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const USER = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  statusWrites.length = 0;
  fakeFetch.mockReset();
  helperMocks.userExists.mockResolvedValue(true);
  helperMocks.markBackfillComplete.mockClear();
  helperMocks.processActivityPage.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runBackfillForUser", () => {
  it("writes advancing progress then completes (the no-longer-stuck path)", async () => {
    // One short page of 50 (< PER_PAGE) so the loop finishes after one page.
    fakeFetch.mockResolvedValueOnce(okPage(50));
    // Real-ish processActivityPage: emit two progress ticks then return 50.
    helperMocks.processActivityPage.mockImplementationOnce(
      async ({ onProgress }: { onProgress?: (n: number) => Promise<void> }) => {
        await onProgress?.(25);
        await onProgress?.(50);
        return 50;
      }
    );

    await runBackfillForUser(USER);

    // The bar advanced 0 → 25 → 50 (durable, not frozen at 0)…
    const completedSeries = statusWrites
      .filter((s) => s.state === "in_progress")
      .map((s) => s.completed);
    expect(completedSeries).toEqual([0, 25, 50]);
    // …and the run reached a real terminal completion.
    expect(helperMocks.markBackfillComplete).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, total: 50 })
    );
    // No failure state was written.
    expect(statusWrites.some((s) => s.state === "failed")).toBe(false);
  });

  it("exits cleanly as failed/timed_out with a partial count when it runs out of budget", async () => {
    // Drive a controllable clock so the soft deadline trips mid-run.
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    fakeFetch.mockResolvedValue(okPage(200)); // full page → loop would continue
    helperMocks.processActivityPage.mockImplementationOnce(
      async ({ onProgress }: { onProgress?: (n: number) => Promise<void> }) => {
        await onProgress?.(30);
        now += 51_000; // simulate ~51s elapsed → past the 50s soft deadline
        return 30;
      }
    );

    await runBackfillForUser(USER);

    const terminal = statusWrites.at(-1)!;
    expect(terminal.state).toBe("failed");
    expect(terminal.error_code).toBe("timed_out");
    expect(terminal.completed).toBe(30);
    expect(String(terminal.error_detail)).toContain("30 workouts");
    // Crucially: it did NOT silently finish in `in_progress` — a terminal
    // state was written, so the UI gets the Retry path immediately.
    expect(helperMocks.markBackfillComplete).not.toHaveBeenCalled();
  });

  it("records the REAL error message in error_detail on an HTTP failure", async () => {
    // Strava 503 → run-backfill throws Error('strava_http_503'); the catch
    // must persist that actual message, not a generic template.
    fakeFetch.mockResolvedValueOnce(new Response("upstream down", { status: 503 }));

    await runBackfillForUser(USER);

    const terminal = statusWrites.at(-1)!;
    expect(terminal.state).toBe("failed");
    expect(terminal.error_detail).toBe("strava_http_503");
    expect(helperMocks.processActivityPage).not.toHaveBeenCalled();
  });
});
