// Pure-unit tests for POST /api/plans (Unit 5 + 7), fully mocked (mirrors
// app/api/weekly-review/__tests__/post-route.test.ts): auth, the
// entitlement-OR-trial gate, the coach link gate, the attempt-row insert, and
// the best-effort enqueue. No real DB / Inngest / env.
//
// The load-bearing invariant under test: a non-owner targeting another athlete
// gets 403 BEFORE the access (paid-status) query runs — no payment oracle.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { PLAN_GENERATE_EVENT } from "@/inngest/functions/generate-plan";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

const ATHLETE = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000b2";

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  access: { allowed: true, entitled: true, trialEligible: false },
  accessCalled: false,
  isCoach: false,
  insertError: null as { message: string } | null,
  insertedRows: [] as Record<string, unknown>[],
  sendShouldThrow: false,
  sentPayloads: [] as unknown[],
  send: vi.fn(),
}));

vi.mock("@/auth/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: mocks.authUser }, error: null }),
    },
  }),
}));

vi.mock("@/ai/adaptive/recipient-auth", () => ({
  isLinkedCoach: vi.fn(async () => mocks.isCoach),
}));

vi.mock("@/auth/trial", () => ({
  resolveGenerationAccess: vi.fn(async () => {
    mocks.accessCalled = true;
    return mocks.access;
  }),
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: mocks.send,
    createFunction: vi.fn(() => ({ id: "mock" })),
  },
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "ai_generation_attempts") {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        insert: (row: Record<string, unknown>) => {
          mocks.insertedRows.push(row);
          return Promise.resolve({ error: mocks.insertError });
        },
      };
    },
  }),
}));

async function invoke(body: unknown): Promise<Response> {
  const { POST } = await import("../route");
  return POST(
    new Request("http://localhost:3000/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

function lastSent(): { name: string; data: Record<string, unknown> } {
  return mocks.sentPayloads.at(-1) as { name: string; data: Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authUser = { id: ATHLETE };
  mocks.access = { allowed: true, entitled: true, trialEligible: false };
  mocks.accessCalled = false;
  mocks.isCoach = false;
  mocks.insertError = null;
  mocks.insertedRows = [];
  mocks.sendShouldThrow = false;
  mocks.sentPayloads = [];
  mocks.send.mockImplementation(async (payload: unknown) => {
    if (mocks.sendShouldThrow) throw new Error("queue down");
    mocks.sentPayloads.push(payload);
    return { ids: ["evt-1"] };
  });
});

describe("POST /api/plans", () => {
  it("entitled owner → 202 + pending attempt + ids-only event", async () => {
    const res = await invoke({ athlete_id: ATHLETE, weekly_hours: 8 });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("accepted");
    expect(body.request_id).toBeTruthy();

    // Pending attempt recorded with the inputs (free-text home).
    expect(mocks.insertedRows).toHaveLength(1);
    expect(mocks.insertedRows[0].status).toBe("pending");
    expect(mocks.insertedRows[0].athlete_id).toBe(ATHLETE);
    expect(mocks.insertedRows[0].requester_kind).toBe("owner");

    // Event carries ids only — NO inputs / free-text.
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const ev = lastSent();
    expect(ev.name).toBe(PLAN_GENERATE_EVENT);
    expect(ev.data.athlete_id).toBe(ATHLETE);
    expect(ev.data.request_id).toBe(body.request_id);
    expect(ev.data.requester_kind).toBe("owner");
    expect(ev.data).not.toHaveProperty("inputs");
    expect(ev.data).not.toHaveProperty("injury_history");
  });

  it("trial-eligible (never-paid) owner → 202", async () => {
    mocks.access = { allowed: true, entitled: false, trialEligible: true };
    const res = await invoke({ athlete_id: ATHLETE, weekly_hours: 6 });
    expect(res.status).toBe(202);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("linked coach targeting an athlete → 202 with requester_kind=coach", async () => {
    mocks.isCoach = true;
    const res = await invoke({ athlete_id: OTHER, weekly_hours: 8 });
    expect(res.status).toBe(202);
    expect(mocks.insertedRows[0].requester_kind).toBe("coach");
    expect(lastSent().data.athlete_id).toBe(OTHER);
  });

  it("unauthenticated → 401", async () => {
    mocks.authUser = null;
    const res = await invoke({ athlete_id: ATHLETE, weekly_hours: 8 });
    expect(res.status).toBe(401);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("invalid body (weekly_hours out of range) → 400", async () => {
    const res = await invoke({ athlete_id: ATHLETE, weekly_hours: 99 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("non-JSON body → 400", async () => {
    const res = await invoke("not-json{");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("non-owner non-coach → 403 BEFORE the access query runs (no payment oracle)", async () => {
    mocks.isCoach = false;
    const res = await invoke({ athlete_id: OTHER, weekly_hours: 8 });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(mocks.accessCalled).toBe(false); // entitlement/trial never probed
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("neither entitled nor trial-eligible → 402", async () => {
    mocks.access = { allowed: false, entitled: false, trialEligible: false };
    const res = await invoke({ athlete_id: ATHLETE, weekly_hours: 8 });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("payment_required");
    expect(body.entitlement_key).toBe("ai_plans");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.insertedRows).toHaveLength(0);
  });

  it("attempt insert failure → 500, no enqueue", async () => {
    mocks.insertError = { message: "boom" };
    const res = await invoke({ athlete_id: ATHLETE, weekly_hours: 8 });
    expect(res.status).toBe(500);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("enqueue failure → still 202 (best-effort, logged)", async () => {
    mocks.sendShouldThrow = true;
    const res = await invoke({ athlete_id: ATHLETE, weekly_hours: 8 });
    expect(res.status).toBe(202);
    expect((await res.json()).status).toBe("accepted");
    expect(mocks.insertedRows).toHaveLength(1); // row was still written
  });
});
