// Unit tests for PATCH /api/profile/timezone, fully mocked (mirrors
// app/api/athlete/coach/disconnect/__tests__/route.test.ts shape): auth,
// input validation, and the self-only update. No real DB.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

const ATHLETE = "00000000-0000-0000-0000-0000000000a1";

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  updateError: null as { message: string } | null,
  updateCalls: [] as { table: string; patch: Record<string, unknown>; eqId: string | null }[],
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
  createAdminClient: () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => {
          mocks.updateCalls.push({ table, patch, eqId: id });
          return Promise.resolve({ error: mocks.updateError });
        },
      }),
    }),
  }),
}));

async function invoke(body: unknown): Promise<Response> {
  const { PATCH } = await import("../route");
  return PATCH(
    new Request("http://localhost:3000/api/profile/timezone", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  mocks.authUser = { id: ATHLETE };
  mocks.updateError = null;
  mocks.updateCalls = [];
});

describe("PATCH /api/profile/timezone", () => {
  it("authenticated athlete with a valid IANA timezone → 204, updates only their own row", async () => {
    const res = await invoke({ timezone: "Asia/Kolkata" });
    expect(res.status).toBe(204);
    expect(mocks.updateCalls).toEqual([
      { table: "users", patch: { timezone: "Asia/Kolkata" }, eqId: ATHLETE },
    ]);
  });

  it("unauthenticated request → 401, no update issued", async () => {
    mocks.authUser = null;
    const res = await invoke({ timezone: "America/Los_Angeles" });
    expect(res.status).toBe(401);
    expect(mocks.updateCalls).toHaveLength(0);
  });

  it("missing timezone field → 400", async () => {
    const res = await invoke({});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
    expect(mocks.updateCalls).toHaveLength(0);
  });

  it("non-string timezone → 400", async () => {
    const res = await invoke({ timezone: 123 });
    expect(res.status).toBe(400);
    expect(mocks.updateCalls).toHaveLength(0);
  });

  it("syntactically invalid IANA timezone → 400, no update issued", async () => {
    const res = await invoke({ timezone: "Not/A_Real_Zone" });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/unrecognized timezone/);
    expect(mocks.updateCalls).toHaveLength(0);
  });

  it("non-JSON body → 400", async () => {
    const res = await invoke("not-json{");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("DB update failure → 500", async () => {
    mocks.updateError = { message: "boom" };
    const res = await invoke({ timezone: "UTC" });
    expect(res.status).toBe(500);
  });
});
