// Pure-unit tests for PATCH /api/plans/[id]/archive (plan Unit 4).
//
// @/db/plans (archivePlan) is mocked directly -- its own DB-backed coverage
// (idempotency, resurrection guard, planned_workouts cascade) lives in
// src/db/__tests__/plans-lifecycle.test.ts. Here we only test the route's
// auth gate and 404-not-403 mapping.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

const ATHLETE = "00000000-0000-0000-0000-0000000000a1";
const PLAN_ID = "00000000-0000-0000-0000-0000000000c3";

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  archiveResult: { ok: false, reason: "not_found" } as
    | { ok: true; plan: Record<string, unknown> }
    | { ok: false; reason: "not_found" },
  archiveError: null as Error | null,
  archiveCalledWith: null as { athleteId: string; planId: string } | null,
}));

vi.mock("@/auth/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: mocks.authUser }, error: null }),
    },
  }),
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({}),
}));

vi.mock("@/db/plans", () => ({
  archivePlan: async (_admin: unknown, athleteId: string, planId: string) => {
    mocks.archiveCalledWith = { athleteId, planId };
    if (mocks.archiveError) throw mocks.archiveError;
    return mocks.archiveResult;
  },
}));

async function invoke(id = PLAN_ID): Promise<Response> {
  const { PATCH } = await import("../route");
  return PATCH(
    new Request(`http://localhost:3000/api/plans/${id}/archive`, { method: "PATCH" }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  mocks.authUser = { id: ATHLETE };
  mocks.archiveResult = { ok: false, reason: "not_found" };
  mocks.archiveError = null;
  mocks.archiveCalledWith = null;
});

describe("PATCH /api/plans/[id]/archive", () => {
  it("archiving the athlete's active plan → 200 with updated plan", async () => {
    mocks.archiveResult = {
      ok: true,
      plan: { id: PLAN_ID, status: "archived", archived_at: "now" },
    };
    const res = await invoke();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan.status).toBe("archived");
    expect(mocks.archiveCalledWith).toEqual({ athleteId: ATHLETE, planId: PLAN_ID });
  });

  it("archiving another athlete's plan → 404, not 403", async () => {
    mocks.archiveResult = { ok: false, reason: "not_found" };
    const res = await invoke();
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect((await res.json()).error).toBe("not_found");
  });

  it("archiving a nonexistent or soft-deleted plan → 404", async () => {
    mocks.archiveResult = { ok: false, reason: "not_found" };
    const res = await invoke();
    expect(res.status).toBe(404);
  });

  it("unauthenticated request → 401", async () => {
    mocks.authUser = null;
    const res = await invoke();
    expect(res.status).toBe(401);
  });

  it("archivePlan failure → 500", async () => {
    mocks.archiveError = new Error("db down");
    const res = await invoke();
    expect(res.status).toBe(500);
  });
});
