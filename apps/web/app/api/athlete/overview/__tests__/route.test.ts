import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
  row: { display_name: "Rupesh Kumar", email: "r@example.com", timezone: "Asia/Kolkata" } as
    | { display_name: string | null; email: string | null; timezone: string | null }
    | null,
  overviewArgs: [] as unknown[][],
  overviewThrows: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/auth/bearer", () => ({
  resolveAuth: async () =>
    mocks.user ? { user: mocks.user, error: null } : { user: null, error: new Error("no") },
}));
vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: mocks.row, error: null }) }),
      }),
    }),
  }),
}));
vi.mock("@/training-overview/overview", () => ({
  getTrainingOverview: async (...args: unknown[]) => {
    mocks.overviewArgs.push(args);
    if (mocks.overviewThrows) throw new Error("boom");
    return { ctl: 49.8, atl: 57.1, tsb: -7.3, hasData: true };
  },
}));

import { GET } from "../route";

describe("GET /api/athlete/overview", () => {
  beforeEach(() => {
    mocks.user = { id: "u1" };
    mocks.overviewArgs = [];
    mocks.overviewThrows = false;
    mocks.row = { display_name: "Rupesh Kumar", email: "r@example.com", timezone: "Asia/Kolkata" };
  });

  it("401s without a user", async () => {
    mocks.user = null;
    const res = await GET(new Request("http://x/api/athlete/overview"));
    expect(res.status).toBe(401);
  });

  it("returns the overview scoped to the caller with greeting inputs", async () => {
    const res = await GET(new Request("http://x/api/athlete/overview"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.firstName).toBe("Rupesh");
    expect(body.timezone).toBe("Asia/Kolkata");
    expect(body.overview.tsb).toBe(-7.3);
    expect(mocks.overviewArgs[0][1]).toBe("u1");
    expect(mocks.overviewArgs[0][2]).toBe("Asia/Kolkata");
  });

  it("falls back to the email local part and UTC", async () => {
    mocks.row = { display_name: null, email: "sam.jones@example.com", timezone: null };
    const body = await (await GET(new Request("http://x/api/athlete/overview"))).json();
    expect(body.firstName).toBe("Sam");
    expect(body.timezone).toBe("UTC");
  });

  it("500s when the overview fails", async () => {
    mocks.overviewThrows = true;
    const res = await GET(new Request("http://x/api/athlete/overview"));
    expect(res.status).toBe(500);
  });
});
