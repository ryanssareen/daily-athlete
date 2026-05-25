// Unit tests for POST /api/weekly-review/[id]/accept (plan Unit 6).
//
// The route depends on:
//   - @/auth/server.createClient + resolveAuth (Bearer / cookie auth)
//   - @/db/admin.createAdminClient (service-role) for recipient authorization
//     (weekly_reviews fetch + coach_athlete_links check)
//   - @/auth/entitlements.requireEntitlement (the 402 paid gate)
//   - @/ai/adaptive/apply.reValidateAndApply (re-validate + apply RPC)
//
// All Supabase access + the apply path are mocked (no real DB, Docker-free).
// The DB-backed apply RPC behavior (per-op staleness, completed refusal,
// event-changed supersede) is covered by the CI Postgres test in
// src/db/__tests__/apply-weekly-review.rls.test.ts. The Node re-validation +
// coupled-abort path is covered by src/ai/adaptive/__tests__/apply.test.ts.
//
// Scenarios:
//   - accept happy (all applied → accepted)
//   - partial (results show skipped_stale → partially_accepted)
//   - entitlement lapse → 402, proposal left readable (apply NOT called)
//   - non-recipient → 403
//   - already-decided proposal → 409 (apply NOT called)
//   - unauthenticated → 401
//   - invalid body → 400
//   - coach recipient: linked coach accepts (200); stranger → 403

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  // The weekly_reviews row returned by the recipient-auth fetch (null = 404).
  review: null as Record<string, unknown> | null,
  // Whether a coach_athlete_links row exists (for recipient='coach').
  coachLinked: false,
  // requireEntitlement result: null (entitled) or a 402-ish NextResponse.
  entitled: true,
  // reValidateAndApply return / throw.
  applyResult: null as Record<string, unknown> | null,
  applyThrows: false,
  // Captured apply args.
  applyArgs: null as { opIds: string[]; actorUserId: string } | null,
}));

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

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
    if (this._table === "weekly_reviews") {
      return { data: mocks.review, error: null };
    }
    if (this._table === "coach_athlete_links") {
      return { data: mocks.coachLinked ? { id: "link-1" } : null, error: null };
    }
    return { data: null, error: null };
  }
}

function makeAdminFake() {
  return {
    from(table: string) {
      return new TableFake(table);
    },
  };
}

vi.mock("@/auth/server", () => ({
  createClient: async () => makeUserClientFake(),
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => makeAdminFake(),
}));

vi.mock("@/auth/entitlements", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireEntitlement: async () =>
      mocks.entitled
        ? null
        : NextResponse.json(
            { error: "payment_required", entitlement_key: "ai_plans" },
            { status: 402 }
          ),
  };
});

vi.mock("@/ai/adaptive/apply", () => ({
  reValidateAndApply: async (
    _review: unknown,
    opIds: string[],
    actorUserId: string
  ) => {
    mocks.applyArgs = { opIds, actorUserId };
    if (mocks.applyThrows) throw new Error("boom");
    return mocks.applyResult;
  },
}));

// ---------------------------------------------------------------------------
// Invocation helper
// ---------------------------------------------------------------------------

async function invoke(
  reviewId: string,
  body: unknown,
  opts: { headers?: Record<string, string> } = {}
): Promise<Response> {
  const { POST } = await import("../route");
  return POST(
    new Request(`http://localhost:3000/api/weekly-review/${reviewId}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: reviewId }) }
  );
}

function athleteReview(over: Record<string, unknown> = {}) {
  return {
    id: "rev-1",
    athlete_id: "ath-1",
    plan_id: "plan-1",
    trigger_kind: "weekly",
    scope: "plan",
    recipient: "athlete",
    status: "proposed",
    proposed_changes: [],
    narrative: null,
    event_date_snapshot: null,
    earliest_affected_date: null,
    generated_at: "2026-05-25T00:00:00.000Z",
    decided_at: null,
    created_at: "2026-05-25T00:00:00.000Z",
    deleted_at: null,
    ...over,
  };
}

beforeEach(() => {
  mocks.authUser = null;
  mocks.review = null;
  mocks.coachLinked = false;
  mocks.entitled = true;
  mocks.applyResult = null;
  mocks.applyThrows = false;
  mocks.applyArgs = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/weekly-review/[id]/accept", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await invoke("rev-1", { op_ids: [] });
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is missing op_ids", async () => {
    mocks.authUser = { id: "ath-1" };
    const res = await invoke("rev-1", { nope: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("returns 404 when the proposal does not exist", async () => {
    mocks.authUser = { id: "ath-1" };
    mocks.review = null;
    const res = await invoke("rev-1", { op_ids: [] });
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-recipient (athlete recipient, different caller)", async () => {
    mocks.authUser = { id: "stranger" };
    mocks.review = athleteReview();
    const res = await invoke("rev-1", { op_ids: ["op-1"] });
    expect(res.status).toBe(403);
    expect(mocks.applyArgs).toBeNull();
  });

  it("returns 402 when entitlement has lapsed (proposal left readable, apply not called)", async () => {
    mocks.authUser = { id: "ath-1" };
    mocks.review = athleteReview();
    mocks.entitled = false;
    const res = await invoke("rev-1", { op_ids: ["op-1"] });
    expect(res.status).toBe(402);
    expect((await res.json()).entitlement_key).toBe("ai_plans");
    expect(mocks.applyArgs).toBeNull();
  });

  it("returns 409 when the proposal is already decided", async () => {
    mocks.authUser = { id: "ath-1" };
    mocks.review = athleteReview({ status: "accepted" });
    const res = await invoke("rev-1", { op_ids: ["op-1"] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_decided");
    expect(mocks.applyArgs).toBeNull();
  });

  it("happy path: all ops applied → 200 accepted", async () => {
    mocks.authUser = { id: "ath-1" };
    mocks.review = athleteReview();
    mocks.applyResult = {
      status: "accepted",
      superseded: false,
      results: [{ op_id: "op-1", outcome: "applied" }],
    };
    const res = await invoke("rev-1", { op_ids: ["op-1"] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("accepted");
    expect(body.results).toEqual([{ op_id: "op-1", outcome: "applied" }]);
    expect(mocks.applyArgs).toEqual({ opIds: ["op-1"], actorUserId: "ath-1" });
  });

  it("partial: some ops skipped_stale → 200 partially_accepted", async () => {
    mocks.authUser = { id: "ath-1" };
    mocks.review = athleteReview();
    mocks.applyResult = {
      status: "partially_accepted",
      superseded: false,
      results: [
        { op_id: "op-1", outcome: "applied" },
        { op_id: "op-2", outcome: "skipped_stale", detail: "workout changed" },
      ],
    };
    const res = await invoke("rev-1", { op_ids: ["op-1", "op-2"] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("partially_accepted");
    expect(body.results).toHaveLength(2);
    expect(body.results[1].outcome).toBe("skipped_stale");
  });

  it("surfaces RPC already_decided race as 409", async () => {
    mocks.authUser = { id: "ath-1" };
    mocks.review = athleteReview();
    mocks.applyResult = {
      status: "rejected",
      superseded: false,
      results: [],
      already_decided: true,
    };
    const res = await invoke("rev-1", { op_ids: ["op-1"] });
    expect(res.status).toBe(409);
  });

  it("returns 500 when apply throws", async () => {
    mocks.authUser = { id: "ath-1" };
    mocks.review = athleteReview();
    mocks.applyThrows = true;
    const res = await invoke("rev-1", { op_ids: ["op-1"] });
    expect(res.status).toBe(500);
  });

  // ----- coach recipient routing -----

  it("coach recipient: an actively-linked coach may accept", async () => {
    mocks.authUser = { id: "coach-1" };
    mocks.review = athleteReview({ recipient: "coach" });
    mocks.coachLinked = true;
    mocks.applyResult = { status: "accepted", superseded: false, results: [] };
    const res = await invoke("rev-1", { op_ids: ["op-1"] });
    expect(res.status).toBe(200);
    // actorUserId is the coach (the verified accepter on the athlete's behalf).
    expect(mocks.applyArgs?.actorUserId).toBe("coach-1");
  });

  it("coach recipient: an unlinked caller → 403", async () => {
    mocks.authUser = { id: "coach-2" };
    mocks.review = athleteReview({ recipient: "coach" });
    mocks.coachLinked = false;
    const res = await invoke("rev-1", { op_ids: ["op-1"] });
    expect(res.status).toBe(403);
    expect(mocks.applyArgs).toBeNull();
  });
});
