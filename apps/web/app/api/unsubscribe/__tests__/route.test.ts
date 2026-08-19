// Unit tests for POST /api/unsubscribe (U8).
//
// The behaviour that matters: this route changes state for a caller with NO
// session, so the signed token is the entire authorization story. These tests
// pin that it switches off exactly the cadence the token names, for exactly the
// user the token names, and nothing else.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

const USER = "00000000-0000-0000-0000-0000000000a1";

const mocks = vi.hoisted(() => ({
  verify: null as
    | { ok: true; userId: string; cadence: "weekly" | "monthly" }
    | { ok: false; reason: string }
    | null,
  updates: [] as Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }>,
  updateError: null as { message: string } | null,
}));

vi.mock("@/email/unsubscribe-token", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/email/unsubscribe-token")>();
  return {
    ...actual,
    verifyUnsubscribeToken: vi.fn(() => mocks.verify),
  };
});

vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table !== "users") throw new Error(`unexpected table: ${table}`);
      return {
        update(patch: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              mocks.updates.push({ patch, filters });
              return Promise.resolve({ error: mocks.updateError });
            },
          };
          return builder;
        },
      };
    },
  }),
}));

async function invoke(body: unknown): Promise<Response> {
  const { POST } = await import("../route");
  return POST(
    new Request("http://localhost:3000/api/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  mocks.verify = { ok: true, userId: USER, cadence: "weekly" };
  mocks.updates = [];
  mocks.updateError = null;
});

describe("POST /api/unsubscribe", () => {
  it("switches off the cadence the token names", async () => {
    const res = await invoke({ token: "tok" });
    expect(res.status).toBe(200);
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0].patch).toEqual({ email_weekly_review: false });
  });

  it("switches off the monthly cadence when that is what the token names", async () => {
    mocks.verify = { ok: true, userId: USER, cadence: "monthly" };
    await invoke({ token: "tok" });
    expect(mocks.updates[0].patch).toEqual({ email_monthly_review: false });
  });

  // The independence guarantee: unsubscribing from one digest must not silence
  // the other.
  it("leaves the other cadence untouched", async () => {
    await invoke({ token: "tok" });
    expect(mocks.updates[0].patch).not.toHaveProperty("email_monthly_review");
  });

  // The id comes from the SIGNED payload; a body-supplied id must be ignored.
  it("scopes the update to the id inside the token, not the request body", async () => {
    const res = await invoke({ token: "tok", userId: "00000000-0000-0000-0000-0000000000ff" });
    expect(res.status).toBe(200);
    expect(mocks.updates[0].filters).toEqual({ id: USER });
  });

  it("only ever writes false — there is no subscribe path here", async () => {
    await invoke({ token: "tok" });
    for (const value of Object.values(mocks.updates[0].patch)) {
      expect(value).toBe(false);
    }
  });

  // AE8 — a tampered or expired token yields a plain failure, no state change.
  it.each([
    ["bad_signature"],
    ["expired"],
    ["malformed"],
    ["unconfigured"],
  ])("rejects a token that failed verification (%s) and writes nothing", async (reason) => {
    mocks.verify = { ok: false, reason };
    const res = await invoke({ token: "tok" });
    expect(res.status).toBe(400);
    expect(mocks.updates).toEqual([]);
  });

  // One generic response for every failure mode: distinguishing them would let
  // someone probing tokens learn which parts they got right.
  it("returns the same error body for every rejection reason", async () => {
    mocks.verify = { ok: false, reason: "expired" };
    const expired = await (await invoke({ token: "tok" })).json();
    mocks.verify = { ok: false, reason: "bad_signature" };
    const forged = await (await invoke({ token: "tok" })).json();
    expect(expired).toEqual(forged);
  });

  it.each([
    ["a missing token", {}],
    ["an empty token", { token: "" }],
    ["a non-string token", { token: 42 }],
  ])("rejects %s", async (_label, body) => {
    expect((await invoke(body)).status).toBe(400);
    expect(mocks.updates).toEqual([]);
  });

  it("rejects a body that is not JSON", async () => {
    expect((await invoke("not json at all")).status).toBe(400);
  });

  it("returns 500 when the write fails", async () => {
    mocks.updateError = { message: "db down" };
    expect((await invoke({ token: "tok" })).status).toBe(500);
  });

  // Setting an already-false column to false is a no-op, so a second click
  // succeeds rather than erroring at someone already unsubscribed.
  it("is idempotent across repeated calls", async () => {
    expect((await invoke({ token: "tok" })).status).toBe(200);
    expect((await invoke({ token: "tok" })).status).toBe(200);
  });
});
