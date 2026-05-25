import { beforeEach, describe, expect, it, vi } from "vitest";

// Chainable supabase-update fake: .from().update().eq().is().lt().select()
// resolves to { data, error }.
const updateResult = vi.hoisted(
  () => ({ value: { data: [] as unknown[] | null, error: null as unknown } }),
);

vi.mock("@/db/admin", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "update", "eq", "is", "lt"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.select = vi.fn(() => updateResult.value);
  return { createAdminClient: () => chain };
});

async function invoke(authHeader?: string) {
  const { GET } = await import("../route");
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return GET(new Request("http://localhost/api/cron/weekly-review-expiry", { headers }));
}

describe("GET /api/cron/weekly-review-expiry", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    updateResult.value = { data: [], error: null };
    vi.resetModules();
  });

  it("returns 401 without the CRON_SECRET", async () => {
    const res = await invoke();
    expect(res.status).toBe(401);
  });

  it("returns 401 with a wrong secret", async () => {
    const res = await invoke("Bearer nope");
    expect(res.status).toBe(401);
  });

  it("expires stale proposals and returns the count", async () => {
    updateResult.value = { data: [{ id: "a" }, { id: "b" }], error: null };
    const res = await invoke("Bearer test-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ expired: 2 });
  });

  it("returns 500 on a query error", async () => {
    updateResult.value = { data: null, error: { message: "boom" } };
    const res = await invoke("Bearer test-secret");
    expect(res.status).toBe(500);
  });
});
