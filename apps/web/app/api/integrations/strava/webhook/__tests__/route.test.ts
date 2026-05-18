// Unit tests for GET + POST /api/integrations/strava/webhook

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
  process.env.STRAVA_TOKEN_KEYS =
    "1:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  process.env.STRAVA_OAUTH_STATE_SIGNING_KEY =
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  process.env.STRAVA_CLIENT_ID = "test-client-id";
  process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
  process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = "test-webhook-token";
  process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID = "12345";
});

// ─── after() capture ─────────────────────────────────────────────────────────

let afterCallback: (() => Promise<void>) | null = null;

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn((fn: () => Promise<void>) => {
      afterCallback = fn;
    }),
  };
});

// ─── mutable test state ───────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  tokenRow: null as { user_id: string } | null,
  tokensDeleted: false,
  deletedWorkouts: [] as { id: string }[],
  deletedMatches: [] as { planned_workout_id: string }[],
  liveMatches: [] as { id: string }[],
  plannedReverted: false,
  stravaFetchOk: true,
  stravaActivity: {
    id: 9999,
    sport_type: "Run",
    start_date: "2026-05-18T08:00:00Z",
    moving_time: 1800,
    elapsed_time: 1900,
    distance: 5000,
    map: null,
  } as Record<string, unknown>,
}));

// ─── admin mock ───────────────────────────────────────────────────────────────

vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      delete: () => ({
        eq: () => {
          if (table === "strava_tokens") state.tokensDeleted = true;
          return Promise.resolve({ data: null, error: null });
        },
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === "strava_tokens") return { data: state.tokenRow };
            return { data: null };
          },
          is: () => ({
            limit: async () => ({ data: state.liveMatches }),
          }),
        }),
      }),
      update: () => ({
        eq: () => ({
          eq: () => {
            if (table === "planned_workouts") {
              state.plannedReverted = true;
              return Promise.resolve({ data: null, error: null });
            }
            // completed_workouts: .eq().eq().is().select()
            return {
              is: () => ({
                select: async () => ({ data: state.deletedWorkouts }),
              }),
            };
          },
          // workout_matches: .eq().is().select()
          is: () => ({
            select: async () => {
              if (table === "workout_matches") return { data: state.deletedMatches };
              return { data: [] };
            },
          }),
        }),
      }),
    }),
  }),
}));

// ─── strava service mocks ─────────────────────────────────────────────────────

vi.mock("@/db/completed-workouts", () => ({
  insertOrUpdateStravaCompletedWorkout: vi.fn().mockResolvedValue("completed-id-abc"),
}));

vi.mock("@/strava/auto-match", () => ({
  matchStravaToPlanned: vi.fn().mockResolvedValue({ matched: false }),
}));

vi.mock("@/strava/client", () => ({
  createStravaClient: vi.fn(() => ({
    fetch: async () => ({
      ok: state.stravaFetchOk,
      json: async () => state.stravaActivity,
    }),
  })),
}));

vi.mock("@/strava/schemas", () => ({
  StravaActivitySchema: { parse: (v: unknown) => v },
}));

vi.mock("@/strava/sport-normalization", () => ({
  normalizeSport: vi.fn(() => "run"),
}));

vi.mock("@/strava/build-summary-stats", () => ({
  buildSummaryStats: vi.fn(() => ({})),
}));

// ─── route import (after all mocks) ──────────────────────────────────────────

import { GET, POST } from "../route";

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeGET(params: Record<string, string>) {
  const url = new URL("http://localhost/api/integrations/strava/webhook");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

function makeEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    object_type: "activity",
    object_id: 9999,
    aspect_type: "create",
    owner_id: 42,
    subscription_id: 12345,
    event_time: 1716012345,
    updates: {},
    ...overrides,
  };
}

function makePOST(body: unknown) {
  return new Request("http://localhost/api/integrations/strava/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("GET /api/integrations/strava/webhook", () => {
  it("returns hub.challenge when verify_token matches", async () => {
    const res = await GET(
      makeGET({
        "hub.mode": "subscribe",
        "hub.challenge": "abc123",
        "hub.verify_token": "test-webhook-token",
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ "hub.challenge": "abc123" });
  });

  it("returns 403 when verify_token is wrong", async () => {
    const res = await GET(
      makeGET({
        "hub.mode": "subscribe",
        "hub.challenge": "abc123",
        "hub.verify_token": "wrong-token",
      })
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 when hub.mode is not subscribe", async () => {
    const res = await GET(
      makeGET({
        "hub.mode": "unsubscribe",
        "hub.challenge": "abc123",
        "hub.verify_token": "test-webhook-token",
      })
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 when hub.challenge is missing", async () => {
    const res = await GET(
      makeGET({
        "hub.mode": "subscribe",
        "hub.verify_token": "test-webhook-token",
      })
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/integrations/strava/webhook", () => {
  beforeEach(() => {
    afterCallback = null;
    state.tokenRow = { user_id: "user-uuid-1" };
    state.tokensDeleted = false;
    state.deletedWorkouts = [];
    state.deletedMatches = [];
    state.liveMatches = [];
    state.plannedReverted = false;
    state.stravaFetchOk = true;
  });

  afterEach(() => vi.clearAllMocks());

  it("returns 200 silently when body is not valid JSON", async () => {
    const req = new Request("http://localhost/api/integrations/strava/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(afterCallback).toBeNull();
  });

  it("returns 200 silently when body fails Zod validation", async () => {
    // Missing required fields: object_id, aspect_type, etc.
    const res = await POST(makePOST({ object_type: "activity" }));
    expect(res.status).toBe(200);
    expect(afterCallback).toBeNull();
  });

  it("returns 200 silently when subscription_id does not match", async () => {
    const res = await POST(makePOST(makeEvent({ subscription_id: 99999 })));
    expect(res.status).toBe(200);
    expect(afterCallback).toBeNull();
  });

  it("hard-deletes strava_tokens row and returns 200 for deauth event", async () => {
    const res = await POST(makePOST(makeEvent({ object_type: "athlete" })));
    expect(res.status).toBe(200);
    expect(state.tokensDeleted).toBe(true);
    expect(afterCallback).toBeNull();
  });

  it("returns 200 for aspect_type=update without deferring work", async () => {
    const res = await POST(makePOST(makeEvent({ aspect_type: "update" })));
    expect(res.status).toBe(200);
    expect(afterCallback).toBeNull();
  });

  it("returns 200 immediately and defers create work via after()", async () => {
    const res = await POST(makePOST(makeEvent({ aspect_type: "create" })));
    expect(res.status).toBe(200);
    expect(afterCallback).not.toBeNull();
  });

  it("returns 200 immediately and defers delete work via after()", async () => {
    const res = await POST(makePOST(makeEvent({ aspect_type: "delete" })));
    expect(res.status).toBe(200);
    expect(afterCallback).not.toBeNull();
  });

  describe("after() — create", () => {
    it("no-ops silently when owner_id has no strava_tokens row", async () => {
      state.tokenRow = null;
      await POST(makePOST(makeEvent({ aspect_type: "create" })));
      await expect(afterCallback!()).resolves.toBeUndefined();
    });

    it("inserts completed workout and calls matchStravaToPlanned", async () => {
      const { insertOrUpdateStravaCompletedWorkout } = await import("@/db/completed-workouts");
      const { matchStravaToPlanned } = await import("@/strava/auto-match");

      await POST(makePOST(makeEvent({ aspect_type: "create", object_id: 9999 })));
      await afterCallback!();

      expect(insertOrUpdateStravaCompletedWorkout).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          strava_activity_id: 9999,
          athlete_id: "user-uuid-1",
          source: "strava",
        })
      );
      expect(matchStravaToPlanned).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ athleteId: "user-uuid-1", completedWorkoutId: "completed-id-abc" })
      );
    });

    it("continues without throwing when matchStravaToPlanned rejects", async () => {
      const { matchStravaToPlanned } = await import("@/strava/auto-match");
      vi.mocked(matchStravaToPlanned).mockRejectedValueOnce(new Error("match failed"));

      await POST(makePOST(makeEvent({ aspect_type: "create" })));
      await expect(afterCallback!()).resolves.toBeUndefined();
    });

    it("logs error_code (not raw err.message) when Strava fetch fails", async () => {
      state.stravaFetchOk = false;
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

      await POST(makePOST(makeEvent({ aspect_type: "create" })));
      await afterCallback!();

      const afterErrorCall = consoleSpy.mock.calls.find(
        (args) => args[0] === "[strava.webhook] after_error"
      );
      expect(afterErrorCall).toBeDefined();
      const payload = JSON.parse(afterErrorCall![1] as string);
      expect(payload).toHaveProperty("error_code");
      expect(Object.keys(payload)).not.toContain("message");
      consoleSpy.mockRestore();
    });
  });

  describe("after() — delete", () => {
    it("reverts planned status to 'planned' when no live match remains", async () => {
      state.deletedWorkouts = [{ id: "cw-1" }];
      state.deletedMatches = [{ planned_workout_id: "pw-1" }];
      state.liveMatches = [];

      await POST(makePOST(makeEvent({ aspect_type: "delete" })));
      await afterCallback!();

      expect(state.plannedReverted).toBe(true);
    });

    it("does not revert planned status when another live match remains", async () => {
      state.deletedWorkouts = [{ id: "cw-1" }];
      state.deletedMatches = [{ planned_workout_id: "pw-1" }];
      state.liveMatches = [{ id: "other-match-id" }];

      await POST(makePOST(makeEvent({ aspect_type: "delete" })));
      await afterCallback!();

      expect(state.plannedReverted).toBe(false);
    });

    it("no-ops when completed_workout row is not found", async () => {
      state.deletedWorkouts = [];

      await POST(makePOST(makeEvent({ aspect_type: "delete" })));
      await afterCallback!();

      expect(state.plannedReverted).toBe(false);
    });
  });
});
