// Unit tests for POST /api/weekly-review/[id]/reject (plan Unit 6).
//
// Mocks @/auth/server + resolveAuth and @/db/admin (recipient-auth fetch +
// coach link check + reject_weekly_review RPC). No real DB (Docker-free).
//
// Scenarios:
//   - reject happy → 200 rejected (RPC changed=true)
//   - already-decided → 409 (RPC changed=false)
//   - non-recipient → 403
//   - not found → 404
//   - unauthenticated → 401

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  review: null as Record<string, unknown> | null,
  coachLinked: false,
  // reject_weekly_review RPC result.
  rejectResult: null as Record<string, unknown> | null,
  rejectError: null as { message: string } | null,
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
}));

function makeUserClientFake() {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: mocks.authUser }, error: null }),
    },
  };
}

class TableFake {
  private _table: string;
  constructor(table: string) {
    this._table = table;
  }
  select() {
    return this;
  }
  eq() {
    return this;
  }
  is() {
    return this;
  }
  limit() {
    return this;
  }
  async maybeSingle() {
    if (this._table === "weekly_reviews") return { data: mocks.review, error: null };
    if (this._table === "coach_athlete_links")
      return { data: mocks.coachLinked ? { id: "link-1" } : null, error: null };
    return { data: null, error: null };
  }
}

function makeAdminFake() {
  return {
    from(table: string) {
      return new TableFake(table);
    },
    rpc(fn: string, args: Record<string, unknown>) {
      mocks.rpcCalls.push({ fn, args });
      return Promise.resolve({ data: mocks.rejectResult, error: mocks.rejectError });
    },
  };
}

vi.mock("@/auth/server", () => ({
  createClient: async () => makeUserClientFake(),
}));
vi.mock("@/db/admin", () => ({
  createAdminClient: () => makeAdminFake(),
}));

async function invoke(reviewId: string, opts: { headers?: Record<string, string> } = {}) {
  const { POST } = await import("../route");
  return POST(
    new Request(`http://localhost:3000/api/weekly-review/${reviewId}/reject`, {
      method: "POST",
      headers: { ...(opts.headers ?? {}) },
    }),
    { params: Promise.resolve({ id: reviewId }) }
  );
}

function athleteReview(over: Record<string, unknown> = {}) {
  return {
    id: "rev-1",
    athlete_id: "ath-1",
    recipient: "athlete",
    status: "proposed",
    deleted_at: null,
    ...over,
  };
}

beforeEach(() => {
  mocks.authUser = null;
  mocks.review = null;
  mocks.coachLinked = false;
  mocks.rejectResult = null;
  mocks.rejectError = null;
  mocks.rpcCalls = [];
});

describe("POST /api/weekly-review/[id]/reject", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await invoke("rev-1");
    expect(res.status).toBe(401);
  });

  it("returns 404 when proposal not found", async () => {
    mocks.authUser = { id: "ath-1" };
    mocks.review = null;
    const res = await invoke("rev-1");
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-recipient", async () => {
    mocks.authUser = { id: "stranger" };
    mocks.review = athleteReview();
    const res = await invoke("rev-1");
    expect(res.status).toBe(403);
    expect(mocks.rpcCalls).toHaveLength(0);
  });

  it("happy path: rejects a proposed proposal → 200", async () => {
    mocks.authUser = { id: "ath-1" };
    mocks.review = athleteReview();
    mocks.rejectResult = { status: "rejected", changed: true };
    const res = await invoke("rev-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("rejected");
    expect(body.changed).toBe(true);
    expect(mocks.rpcCalls[0]).toEqual({
      fn: "reject_weekly_review",
      args: { p_review_id: "rev-1" },
    });
  });

  it("already-decided → 409 (RPC changed=false)", async () => {
    mocks.authUser = { id: "ath-1" };
    mocks.review = athleteReview({ status: "accepted" });
    mocks.rejectResult = { status: "accepted", changed: false };
    const res = await invoke("rev-1");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_decided");
  });

  it("coach recipient: linked coach may reject", async () => {
    mocks.authUser = { id: "coach-1" };
    mocks.review = athleteReview({ recipient: "coach" });
    mocks.coachLinked = true;
    mocks.rejectResult = { status: "rejected", changed: true };
    const res = await invoke("rev-1");
    expect(res.status).toBe(200);
  });

  it("returns 500 when the RPC errors", async () => {
    mocks.authUser = { id: "ath-1" };
    mocks.review = athleteReview();
    mocks.rejectError = { message: "db down" };
    const res = await invoke("rev-1");
    expect(res.status).toBe(500);
  });
});
