// Pure-unit tests for GET + DELETE /api/plans/[id] (plan Units 3 + 5).
//
// @/db/plans (getPlan, softDeletePlan) is mocked directly rather than
// re-faking the Supabase query builder -- both have their own DB-backed
// coverage in src/db/__tests__/plans-lifecycle.test.ts; here we only test
// the route's auth gate, 404-not-403 ownership handling, and response
// envelope/status codes.

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
  getPlanResult: null as Record<string, unknown> | null,
  getPlanError: null as Error | null,
  getPlanCalledWith: null as { athleteId: string; planId: string } | null,
  softDeleteResult: { ok: false, reason: "not_found" } as
    | { ok: true; plan: Record<string, unknown> }
    | { ok: false; reason: "not_found" },
  softDeleteError: null as Error | null,
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
  getPlan: async (_admin: unknown, athleteId: string, planId: string) => {
    mocks.getPlanCalledWith = { athleteId, planId };
    if (mocks.getPlanError) throw mocks.getPlanError;
    return mocks.getPlanResult;
  },
  softDeletePlan: async () => {
    if (mocks.softDeleteError) throw mocks.softDeleteError;
    return mocks.softDeleteResult;
  },
}));

async function invokeGet(id = PLAN_ID): Promise<Response> {
  const { GET } = await import("../route");
  return GET(new Request(`http://localhost:3000/api/plans/${id}`, { method: "GET" }), {
    params: Promise.resolve({ id }),
  });
}

async function invokeDelete(id = PLAN_ID): Promise<Response> {
  const { DELETE } = await import("../route");
  return DELETE(new Request(`http://localhost:3000/api/plans/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  mocks.authUser = { id: ATHLETE };
  mocks.getPlanResult = null;
  mocks.getPlanError = null;
  mocks.getPlanCalledWith = null;
  mocks.softDeleteResult = { ok: false, reason: "not_found" };
  mocks.softDeleteError = null;
});

describe("GET /api/plans/[id]", () => {
  it("owner requests their own plan → 200 with full plan detail", async () => {
    mocks.getPlanResult = { id: PLAN_ID, status: "active" };
    const res = await invokeGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toEqual(mocks.getPlanResult);
    expect(mocks.getPlanCalledWith).toEqual({ athleteId: ATHLETE, planId: PLAN_ID });
  });

  it("nonexistent plan id → 404", async () => {
    mocks.getPlanResult = null;
    const res = await invokeGet();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("another athlete's plan id → 404, not 403 (no existence leak)", async () => {
    // getPlan itself folds ownership mismatch into null -- the route can't
    // and shouldn't distinguish it from not-found.
    mocks.getPlanResult = null;
    const res = await invokeGet();
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it("a soft-deleted plan of the caller's own → 404 (deleted means gone)", async () => {
    mocks.getPlanResult = null; // getPlan already filters deleted_at IS NULL
    const res = await invokeGet();
    expect(res.status).toBe(404);
  });

  it("unauthenticated request → 401", async () => {
    mocks.authUser = null;
    const res = await invokeGet();
    expect(res.status).toBe(401);
  });

  it("getPlan failure → 500", async () => {
    mocks.getPlanError = new Error("db down");
    const res = await invokeGet();
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/plans/[id]", () => {
  it("deleting an owned plan → 204", async () => {
    mocks.softDeleteResult = { ok: true, plan: { id: PLAN_ID, deleted_at: "now" } };
    const res = await invokeDelete();
    expect(res.status).toBe(204);
  });

  it("deleting another athlete's plan → 404", async () => {
    mocks.softDeleteResult = { ok: false, reason: "not_found" };
    const res = await invokeDelete();
    expect(res.status).toBe(404);
  });

  it("unauthenticated request → 401", async () => {
    mocks.authUser = null;
    const res = await invokeDelete();
    expect(res.status).toBe(401);
  });

  it("softDeletePlan failure → 500", async () => {
    mocks.softDeleteError = new Error("db down");
    const res = await invokeDelete();
    expect(res.status).toBe(500);
  });
});
