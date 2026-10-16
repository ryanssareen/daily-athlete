// GET /api/plans/[id]/view -- auth, ownership, validation and the bearer path.
// Only resolveAuth, getPlan and the admin client are stubbed; buildPlanView
// runs for real against a recording fake so the test proves data access goes
// through the admin client with the athlete filter (a request with no cookies
// would read zero rows through an RLS-bound client).

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanRow } from "@da2/shared";

import type { RecordedQuery } from "@/plan/__tests__/fake-admin";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

const ATHLETE = "00000000-0000-0000-0000-0000000000a1";
const PLAN_ID = "00000000-0000-0000-0000-0000000000c3";

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  plan: null as unknown,
  getPlanThrows: false,
  tables: {} as Record<string, { data?: unknown[]; error?: { message: string } }>,
  queries: [] as RecordedQuery[],
  getPlanArgs: null as unknown[] | null,
}));

vi.mock("@/auth/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/auth/bearer", () => ({
  resolveAuth: async () => ({ user: mocks.user, error: null }),
}));
vi.mock("@/db/admin", async () => {
  const { fakeAdmin: make } = await import("@/plan/__tests__/fake-admin");
  return {
    createAdminClient: () => {
      const { client, queries } = make(mocks.tables);
      mocks.queries = queries;
      return client;
    },
  };
});
vi.mock("@/db/plans", () => ({
  getPlan: async (...args: unknown[]) => {
    mocks.getPlanArgs = args;
    if (mocks.getPlanThrows) throw new Error("db exploded: secret detail");
    return mocks.plan;
  },
}));

import { GET } from "../route";

const plan = {
  id: PLAN_ID,
  athlete_id: ATHLETE,
  status: "active",
  event_type: null,
  event_date: null,
  source: "imported",
  created_from_review_id: null,
  created_at: "2026-10-01T00:00:00Z",
  archived_at: null,
  deleted_at: null,
} as PlanRow;

function call(id: string) {
  return GET(new Request(`http://localhost/api/plans/${id}/view`, {
    headers: { Authorization: "Bearer test-token" },
  }), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  mocks.user = { id: ATHLETE };
  mocks.plan = plan;
  mocks.getPlanThrows = false;
  mocks.getPlanArgs = null;
  mocks.queries = [];
  mocks.tables = {
    users: { data: [{ timezone: "UTC" }] },
    planned_workouts: {
      data: [
        {
          id: "p1",
          scheduled_date: "2026-10-20",
          sport: "run",
          status: "planned",
          structure: { duration_s: 3600 },
          rationale: null,
          planned_load: 50,
        },
      ],
    },
  };
});

describe("GET /api/plans/[id]/view", () => {
  it("returns 401 without auth", async () => {
    mocks.user = null;
    const res = await call(PLAN_ID);
    expect(res.status).toBe(401);
  });

  it("returns 404 for a non-UUID id without touching the database", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(404);
    expect(mocks.getPlanArgs).toBeNull();
  });

  it("returns 404 when the plan is missing or not the caller's", async () => {
    mocks.plan = null;
    const res = await call(PLAN_ID);
    expect(res.status).toBe(404);
    expect(mocks.getPlanArgs?.[1]).toBe(ATHLETE);
  });

  it("serves the view on the bearer path through the admin client with the athlete filter", async () => {
    const res = await call(PLAN_ID);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await res.json()) as { view: { planId: string; weeks: unknown[] } };
    expect(body.view.planId).toBe(PLAN_ID);
    expect(body.view.weeks).toHaveLength(1);
    const plannedQuery = mocks.queries.find((q) => q.table === "planned_workouts");
    expect(plannedQuery?.filters).toContainEqual({ op: "eq", column: "athlete_id", value: ATHLETE });
  });

  it("returns a generic 500 body that leaks no database detail", async () => {
    mocks.getPlanThrows = true;
    const res = await call(PLAN_ID);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });

  it("returns 404 when the plan's athlete does not match the caller", async () => {
    mocks.plan = { ...plan, athlete_id: "00000000-0000-0000-0000-0000000000b2" };
    const res = await call(PLAN_ID);
    expect(res.status).toBe(404);
  });
});
