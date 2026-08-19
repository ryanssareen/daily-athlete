// Unit tests for GET/PATCH /api/profile/email-preferences (U8).
//
// The regression this file exists to prevent: an RLS-scoped write here would
// silently match ZERO rows for a Bearer (mobile) caller -- the athlete taps the
// toggle, it looks like it worked, and nothing is saved. That bug has already
// happened once in this repo (/api/profile/timezone). So the fakes enforce the
// client split: `.from()` on the AUTH client throws, and the Bearer test proves
// a cookie-less caller really does write.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

const USER = "00000000-0000-0000-0000-0000000000a1";
const BEARER = "mobile-access-token";

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  getUserTokens: [] as (string | undefined)[],
  row: { email_weekly_review: false, email_monthly_review: false } as Record<string, boolean>,
  readError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  updates: [] as Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }>,
  selectFilters: [] as Record<string, unknown>[],
}));

function makeAuthClientFake() {
  return {
    auth: {
      getUser: (token?: string) => {
        mocks.getUserTokens.push(token);
        return Promise.resolve({ data: { user: mocks.authUser }, error: null });
      },
    },
    from(table: string) {
      throw new Error(
        `route read table "${table}" under the AUTH client -- a Bearer caller would write zero rows`,
      );
    },
  };
}

vi.mock("@/auth/server", () => ({ createClient: async () => makeAuthClientFake() }));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table !== "users") throw new Error(`unexpected table: ${table}`);
      return {
        select() {
          const filters: Record<string, unknown> = {};
          return {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return this;
            },
            maybeSingle() {
              mocks.selectFilters.push(filters);
              return Promise.resolve({
                data: mocks.readError ? null : mocks.row,
                error: mocks.readError,
              });
            },
          };
        },
        update(patch: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          return {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return this;
            },
            select() {
              return this;
            },
            maybeSingle() {
              mocks.updates.push({ patch, filters });
              if (mocks.updateError) return Promise.resolve({ data: null, error: mocks.updateError });
              Object.assign(mocks.row, patch);
              return Promise.resolve({ data: { ...mocks.row }, error: null });
            },
          };
        },
      };
    },
  }),
}));

async function invokeGet(opts: { bearer?: string } = {}): Promise<Response> {
  const { GET } = await import("../route");
  const headers = opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : undefined;
  return GET(new Request("http://localhost:3000/api/profile/email-preferences", { headers }));
}

async function invokePatch(body: unknown, opts: { bearer?: string } = {}): Promise<Response> {
  const { PATCH } = await import("../route");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  return PATCH(
    new Request("http://localhost:3000/api/profile/email-preferences", {
      method: "PATCH",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  mocks.authUser = { id: USER };
  mocks.getUserTokens = [];
  mocks.row = { email_weekly_review: false, email_monthly_review: false };
  mocks.readError = null;
  mocks.updateError = null;
  mocks.updates = [];
  mocks.selectFilters = [];
});

describe("GET", () => {
  it("returns both preferences", async () => {
    mocks.row = { email_weekly_review: true, email_monthly_review: false };
    const body = await (await invokeGet()).json();
    expect(body).toEqual({ weeklyReview: true, monthlyReview: false });
  });

  it("scopes the read to the authenticated caller", async () => {
    await invokeGet();
    expect(mocks.selectFilters[0]).toEqual({ id: USER });
  });

  it("rejects an unauthenticated caller", async () => {
    mocks.authUser = null;
    expect((await invokeGet()).status).toBe(401);
  });

  it("returns 500 when the read fails", async () => {
    mocks.readError = { message: "db down" };
    expect((await invokeGet()).status).toBe(500);
  });
});

describe("PATCH", () => {
  it("updates a single cadence", async () => {
    const res = await invokePatch({ weeklyReview: true });
    expect(res.status).toBe(200);
    expect(mocks.updates[0].patch).toEqual({ email_weekly_review: true });
  });

  // An update naming one preference must not reset the other to its default.
  it("leaves an unnamed cadence out of the write entirely", async () => {
    await invokePatch({ weeklyReview: true });
    expect(mocks.updates[0].patch).not.toHaveProperty("email_monthly_review");
  });

  it("updates both cadences when both are named", async () => {
    await invokePatch({ weeklyReview: true, monthlyReview: true });
    expect(mocks.updates[0].patch).toEqual({
      email_weekly_review: true,
      email_monthly_review: true,
    });
  });

  it("echoes the stored state back so the client can trust it over its guess", async () => {
    const body = await (await invokePatch({ monthlyReview: true })).json();
    expect(body).toEqual({ weeklyReview: false, monthlyReview: true });
  });

  it("scopes the write to the authenticated caller", async () => {
    await invokePatch({ weeklyReview: true });
    expect(mocks.updates[0].filters).toEqual({ id: USER });
  });

  it("ignores a client-supplied id", async () => {
    await invokePatch({ weeklyReview: true, id: "00000000-0000-0000-0000-0000000000ff" });
    // `.strict()` rejects the unknown key outright rather than writing it.
    expect(mocks.updates).toEqual([]);
  });

  // A typo must fail loudly, not silently not save.
  it("rejects an unknown preference key", async () => {
    const res = await invokePatch({ weekly_review: true });
    expect(res.status).toBe(400);
    expect(mocks.updates).toEqual([]);
  });

  it("rejects an empty update rather than performing a no-op write", async () => {
    expect((await invokePatch({})).status).toBe(400);
    expect(mocks.updates).toEqual([]);
  });

  it("rejects a non-boolean value", async () => {
    expect((await invokePatch({ weeklyReview: "yes" })).status).toBe(400);
  });

  it("rejects a body that is not JSON", async () => {
    expect((await invokePatch("not json")).status).toBe(400);
  });

  it("rejects an unauthenticated caller", async () => {
    mocks.authUser = null;
    expect((await invokePatch({ weeklyReview: true })).status).toBe(401);
    expect(mocks.updates).toEqual([]);
  });

  it("returns 500 when the write fails", async () => {
    mocks.updateError = { message: "db down" };
    expect((await invokePatch({ weeklyReview: true })).status).toBe(500);
  });

  // THE REGRESSION GUARD: a cookie-less Bearer caller must actually persist.
  it("persists for a Bearer-authenticated caller with no cookies", async () => {
    const res = await invokePatch({ weeklyReview: true }, { bearer: BEARER });
    expect(res.status).toBe(200);
    expect(mocks.getUserTokens).toContain(BEARER);
    expect(mocks.updates[0].filters).toEqual({ id: USER });
  });
});
