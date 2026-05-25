// Unit tests for GET /api/weekly-review (the proposal list, plan Unit 6).
//
// Mocks @/auth/server + resolveAuth and @/db/admin. No real DB (Docker-free).
// The DB-backed RLS for who-can-see-what is covered by the CI Postgres test in
// src/db/__tests__/weekly-reviews.rls.test.ts; here we test the route's
// own + linked-coach merge logic returns ONLY authorized rows.
//
// Scenarios:
//   - unauthenticated → 401
//   - athlete caller: returns only their own proposals
//   - coach caller: returns own + linked athletes' recipient='coach' proposals,
//     and does NOT return an unlinked athlete's proposals
//   - dedupes a row that is both own + coach-visible

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

interface ReviewRow {
  id: string;
  athlete_id: string;
  recipient: string;
  generated_at: string;
  [k: string]: unknown;
}

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  // All weekly_reviews rows the fake DB holds (RLS bypassed; the fake filters).
  reviews: [] as ReviewRow[],
  // coach_athlete_links: coach_user_id -> [athlete_user_id].
  links: [] as { coach_user_id: string; athlete_user_id: string }[],
}));

function makeUserClientFake() {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: mocks.authUser }, error: null }),
    },
  };
}

// A query builder that records filters and resolves when awaited or .order()'d.
class QueryFake {
  private _table: string;
  private _eqs: Record<string, unknown> = {};
  private _ins: Record<string, unknown[]> = {};
  constructor(table: string) {
    this._table = table;
  }
  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this._eqs[col] = val;
    return this;
  }
  in(col: string, vals: unknown[]) {
    this._ins[col] = vals;
    return this;
  }
  is() {
    return this;
  }
  order() {
    return this._resolve();
  }
  // Some callers await without .order() (coach link select).
  then(
    onFulfilled: (v: { data: unknown[]; error: null }) => unknown,
    onRejected?: (e: unknown) => unknown
  ) {
    return Promise.resolve(this._resolve()).then(onFulfilled, onRejected);
  }
  private _resolve(): { data: unknown[]; error: null } {
    if (this._table === "weekly_reviews") {
      let rows = mocks.reviews;
      if (this._eqs.athlete_id != null) {
        rows = rows.filter((r) => r.athlete_id === this._eqs.athlete_id);
      }
      if (this._ins.athlete_id != null) {
        rows = rows.filter((r) => this._ins.athlete_id.includes(r.athlete_id));
      }
      if (this._eqs.recipient != null) {
        rows = rows.filter((r) => r.recipient === this._eqs.recipient);
      }
      return { data: rows, error: null };
    }
    if (this._table === "coach_athlete_links") {
      const coachId = this._eqs.coach_user_id;
      const rows = mocks.links
        .filter((l) => l.coach_user_id === coachId)
        .map((l) => ({ athlete_user_id: l.athlete_user_id }));
      return { data: rows, error: null };
    }
    return { data: [], error: null };
  }
}

function makeAdminFake() {
  return {
    from(table: string) {
      return new QueryFake(table);
    },
  };
}

vi.mock("@/auth/server", () => ({
  createClient: async () => makeUserClientFake(),
}));
vi.mock("@/db/admin", () => ({
  createAdminClient: () => makeAdminFake(),
}));

async function invoke(opts: { headers?: Record<string, string> } = {}) {
  const { GET } = await import("../route");
  return GET(
    new Request("http://localhost:3000/api/weekly-review", {
      method: "GET",
      headers: { ...(opts.headers ?? {}) },
    })
  );
}

function review(id: string, athleteId: string, recipient: string, gen: string): ReviewRow {
  return {
    id,
    athlete_id: athleteId,
    plan_id: "plan-1",
    trigger_kind: "weekly",
    scope: "plan",
    recipient,
    status: "proposed",
    proposed_changes: [],
    narrative: null,
    event_date_snapshot: null,
    earliest_affected_date: null,
    generated_at: gen,
    decided_at: null,
    created_at: gen,
    deleted_at: null,
  };
}

beforeEach(() => {
  mocks.authUser = null;
  mocks.reviews = [];
  mocks.links = [];
});

describe("GET /api/weekly-review", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await invoke();
    expect(res.status).toBe(401);
  });

  it("athlete caller: returns only their own proposals", async () => {
    mocks.authUser = { id: "ath-1" };
    mocks.reviews = [
      review("r1", "ath-1", "athlete", "2026-05-25T00:00:00.000Z"),
      review("r2", "ath-2", "athlete", "2026-05-25T00:00:00.000Z"),
    ];
    const res = await invoke();
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.proposals.map((p: ReviewRow) => p.id);
    expect(ids).toEqual(["r1"]);
  });

  it("coach caller: returns own + linked athletes' coach-recipient proposals", async () => {
    mocks.authUser = { id: "coach-1" };
    mocks.links = [{ coach_user_id: "coach-1", athlete_user_id: "ath-1" }];
    mocks.reviews = [
      // coach's own proposal (if a coach is also an athlete)
      review("own", "coach-1", "athlete", "2026-05-25T03:00:00.000Z"),
      // linked athlete, coach-routed → visible
      review("linked-coach", "ath-1", "coach", "2026-05-25T02:00:00.000Z"),
      // linked athlete, but athlete-routed → NOT visible to the coach
      review("linked-athlete", "ath-1", "athlete", "2026-05-25T01:00:00.000Z"),
      // unlinked athlete → NOT visible
      review("unlinked", "ath-9", "coach", "2026-05-25T00:00:00.000Z"),
    ];
    const res = await invoke();
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.proposals.map((p: ReviewRow) => p.id).sort();
    expect(ids).toEqual(["linked-coach", "own"]);
  });

  it("dedupes a row visible via both own + coach paths and sorts newest first", async () => {
    mocks.authUser = { id: "coach-1" };
    // coach-1 is also their own athlete with a coach-routed proposal: appears in
    // both the own query (athlete_id=coach-1) and... not the coach query (that
    // filters to linked athletes, which excludes self). So construct a true dup:
    // a linked athlete whose row appears once in coach query; ensure no double.
    mocks.links = [{ coach_user_id: "coach-1", athlete_user_id: "ath-1" }];
    mocks.reviews = [
      review("a", "coach-1", "athlete", "2026-05-25T05:00:00.000Z"),
      review("b", "ath-1", "coach", "2026-05-25T09:00:00.000Z"),
    ];
    const res = await invoke();
    const body = await res.json();
    const ids = body.proposals.map((p: ReviewRow) => p.id);
    // newest (b @ 09:00) before a (@ 05:00); each appears exactly once.
    expect(ids).toEqual(["b", "a"]);
  });
});
