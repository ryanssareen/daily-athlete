// Unit tests for POST /api/weekly-review — "request a replan" (plan Unit 10).
//
// Pure-unit, fully mocked (mirrors app/api/activities/manual/__tests__):
//   - @/auth/server.createClient + resolveAuth (via supabase.auth.getUser)
//   - @/auth/entitlements.requireEntitlement (entitlement gate → 402)
//   - @/inngest/client.inngest.send (capture the enqueued event)
//   - @/db/admin.createAdminClient (planned_workouts lookup for workout_swap)
//   - @/ai/adaptive/recipient-auth.isLinkedCoach (coach gate for workout_swap)
//
// No real DB, Inngest, or env. Scenarios:
//   - happy per trigger_kind → 202 + correct event payload (scope mapping,
//     unique dedup_key);
//   - workout_swap requires workout_id (400 without);
//   - free user → 402;
//   - unauthenticated → 401;
//   - enqueue failure → still 202 (logged, best-effort).

import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADAPTIVE_RUN_EVENT } from "@/inngest/functions/adaptive-run";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  // requireEntitlement: null = entitled (proceed), or a NextResponse = 402.
  entitled: true,
  // planned_workouts lookup result for workout_swap.
  workoutRow: null as { athlete_id: string } | null,
  workoutError: null as { message: string } | null,
  // isLinkedCoach result for non-owner workout_swap.
  isCoach: false,
  // inngest.send fake: capture payloads; optionally throw.
  sendShouldThrow: false,
  sentPayloads: [] as unknown[],
  send: vi.fn(),
}));

// ---------------------------------------------------------------------------
// vi.mock
// ---------------------------------------------------------------------------

vi.mock("@/auth/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: mocks.authUser }, error: null }),
    },
  }),
}));

vi.mock("@/auth/entitlements", () => ({
  requireEntitlement: vi.fn(async () =>
    mocks.entitled
      ? null
      : NextResponse.json(
          { error: "payment_required", entitlement_key: "ai_plans" },
          { status: 402 },
        ),
  ),
}));

vi.mock("@/ai/adaptive/recipient-auth", () => ({
  isLinkedCoach: vi.fn(async () => mocks.isCoach),
}));

vi.mock("@/inngest/client", () => ({
  // createFunction is exercised at module load by adaptive-run.ts (imported for
  // ADAPTIVE_RUN_EVENT); stub it so the import doesn't throw.
  inngest: {
    send: mocks.send,
    createFunction: vi.fn(() => ({ id: "mock" })),
  },
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "planned_workouts") {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: mocks.workoutRow,
                  error: mocks.workoutError,
                }),
            }),
          }),
        }),
      };
    },
  }),
}));

// ---------------------------------------------------------------------------
// Route invocation helper
// ---------------------------------------------------------------------------

async function invokeRoute(body: unknown): Promise<Response> {
  const { POST } = await import("../route");
  return POST(
    new Request("http://localhost:3000/api/weekly-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function lastSent(): { name: string; data: Record<string, unknown> } {
  return mocks.sentPayloads.at(-1) as {
    name: string;
    data: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authUser = { id: "athlete-1" };
  mocks.entitled = true;
  mocks.workoutRow = null;
  mocks.workoutError = null;
  mocks.isCoach = false;
  mocks.sendShouldThrow = false;
  mocks.sentPayloads = [];
  mocks.send.mockImplementation(async (payload: unknown) => {
    if (mocks.sendShouldThrow) throw new Error("queue down");
    mocks.sentPayloads.push(payload);
    return { ids: ["evt-1"] };
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/weekly-review (request a replan)", () => {
  // ------------------------------------------------------------------
  // Happy path per trigger_kind
  // ------------------------------------------------------------------

  it("manual → 202 + plan-scoped event with manual trigger_kind", async () => {
    const res = await invokeRoute({ trigger_kind: "manual" });
    expect(res.status).toBe(202);
    expect((await res.json()).status).toBe("accepted");

    expect(mocks.send).toHaveBeenCalledTimes(1);
    const ev = lastSent();
    expect(ev.name).toBe(ADAPTIVE_RUN_EVENT);
    expect(ev.data.athlete_id).toBe("athlete-1");
    expect(ev.data.trigger_kind).toBe("manual");
    expect(ev.data.scope).toBe("plan");
    expect(ev.data.dedup_key).toBeTruthy();
  });

  it("schedule_shock → 202 + plan-scoped event", async () => {
    const res = await invokeRoute({ trigger_kind: "schedule_shock" });
    expect(res.status).toBe(202);
    const ev = lastSent();
    expect(ev.data.trigger_kind).toBe("schedule_shock");
    expect(ev.data.scope).toBe("plan");
  });

  it("event_change → 202 + plan-scoped event", async () => {
    const res = await invokeRoute({ trigger_kind: "event_change" });
    expect(res.status).toBe(202);
    const ev = lastSent();
    expect(ev.data.trigger_kind).toBe("event_change");
    expect(ev.data.scope).toBe("plan");
  });

  it("workout_swap (owner) → 202 + workout-scoped event for the workout's athlete", async () => {
    mocks.workoutRow = { athlete_id: "athlete-1" }; // caller owns it
    const res = await invokeRoute({
      trigger_kind: "workout_swap",
      workout_id: "11111111-1111-1111-1111-111111111111",
    });
    expect(res.status).toBe(202);
    const ev = lastSent();
    expect(ev.data.trigger_kind).toBe("workout_swap");
    expect(ev.data.scope).toBe("workout");
    expect(ev.data.athlete_id).toBe("athlete-1");
  });

  it("each on-demand request gets a UNIQUE dedup_key", async () => {
    await invokeRoute({ trigger_kind: "manual" });
    await invokeRoute({ trigger_kind: "manual" });
    expect(mocks.sentPayloads).toHaveLength(2);
    const k1 = (mocks.sentPayloads[0] as { data: { dedup_key: string } }).data
      .dedup_key;
    const k2 = (mocks.sentPayloads[1] as { data: { dedup_key: string } }).data
      .dedup_key;
    expect(k1).not.toBe(k2);
  });

  // ------------------------------------------------------------------
  // workout_swap authorization for a linked coach
  // ------------------------------------------------------------------

  it("workout_swap (linked coach) → 202 for the workout's athlete", async () => {
    mocks.workoutRow = { athlete_id: "athlete-2" }; // not the caller
    mocks.isCoach = true; // caller is an active linked coach
    const res = await invokeRoute({
      trigger_kind: "workout_swap",
      workout_id: "22222222-2222-2222-2222-222222222222",
    });
    expect(res.status).toBe(202);
    expect(lastSent().data.athlete_id).toBe("athlete-2");
  });

  it("workout_swap by a non-owner non-coach → 403", async () => {
    mocks.workoutRow = { athlete_id: "athlete-2" };
    mocks.isCoach = false;
    const res = await invokeRoute({
      trigger_kind: "workout_swap",
      workout_id: "22222222-2222-2222-2222-222222222222",
    });
    expect(res.status).toBe(403);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("workout_swap on a missing workout → 404", async () => {
    mocks.workoutRow = null;
    const res = await invokeRoute({
      trigger_kind: "workout_swap",
      workout_id: "33333333-3333-3333-3333-333333333333",
    });
    expect(res.status).toBe(404);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------------

  it("workout_swap without workout_id → 400 invalid_input", async () => {
    const res = await invokeRoute({ trigger_kind: "workout_swap" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("unrecognised trigger_kind → 400 invalid_input", async () => {
    const res = await invokeRoute({ trigger_kind: "weekly" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("non-JSON body → 400 invalid_input", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost:3000/api/weekly-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json{",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  // ------------------------------------------------------------------
  // Auth + entitlement
  // ------------------------------------------------------------------

  it("unauthenticated → 401", async () => {
    mocks.authUser = null;
    const res = await invokeRoute({ trigger_kind: "manual" });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("free user (no ai_plans) → 402", async () => {
    mocks.entitled = false;
    const res = await invokeRoute({ trigger_kind: "manual" });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("payment_required");
    expect(body.entitlement_key).toBe("ai_plans");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Best-effort enqueue posture
  // ------------------------------------------------------------------

  it("enqueue failure → still 202 (logged, no rollback)", async () => {
    mocks.sendShouldThrow = true;
    const res = await invokeRoute({ trigger_kind: "manual" });
    expect(res.status).toBe(202);
    expect((await res.json()).status).toBe("accepted");
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
