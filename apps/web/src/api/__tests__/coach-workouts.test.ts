// Unit tests for POST /api/coach/workouts
//
// Dependencies mocked:
// - @/auth/server (JWT client for resolveAuth + role_flags lookup)
// - @/db/admin (service-role for coach_athlete_links + planned_workouts)
//
// Scenarios:
// - linked coach → 201, row created
// - not a coach (role_flags = ['athlete']) → 403
// - coach but not linked to the target athlete → 403
// - invalid sport value → 400
// - missing Bearer token → 401

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  // role_flags for the authenticated user.
  userRoleFlags: ["athlete"] as string[],
  // Active coach-athlete links keyed as "coachId:athleteId".
  activeLinks: new Set<string>(),
  // Captures the last INSERT call to planned_workouts.
  lastInsert: null as Record<string, unknown> | null,
  // If set, the next insert returns this error.
  nextInsertError: null as { message: string } | null,
}));

vi.mock("@/auth/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: (_token?: string) =>
        Promise.resolve({ data: { user: mocks.authUser }, error: null }),
    },
    from(table: string) {
      if (table === "users") {
        return new FakeUsersTable();
      }
      throw new Error(`unexpected user client table: ${table}`);
    },
  }),
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "coach_athlete_links") return new FakeLinksTable();
      if (table === "planned_workouts") return new FakeWorkoutsTable();
      throw new Error(`unexpected admin table: ${table}`);
    },
  }),
}));

// FakeUsersTable — returns role_flags for the authenticated user.
class FakeUsersTable {
  select(_cols: string) {
    return this;
  }
  eq(_col: string, _val: string) {
    return this;
  }
  async maybeSingle() {
    if (!mocks.authUser) return { data: null, error: null };
    return {
      data: { role_flags: mocks.userRoleFlags },
      error: null,
    };
  }
}

// FakeLinksTable — checks if an active link exists for coach+athlete pair.
class FakeLinksTable {
  private _coachId: string | null = null;
  private _athleteId: string | null = null;
  private _status: string | null = null;

  select(_cols: string) {
    return this;
  }
  eq(col: string, value: string) {
    if (col === "coach_user_id") this._coachId = value;
    if (col === "athlete_user_id") this._athleteId = value;
    if (col === "status") this._status = value;
    return this;
  }
  is(_col: string, _val: null) {
    return this;
  }
  async maybeSingle() {
    const key = `${this._coachId}:${this._athleteId}`;
    if (
      this._status === "active" &&
      this._coachId &&
      this._athleteId &&
      mocks.activeLinks.has(key)
    ) {
      return { data: { id: "link-id-1" }, error: null };
    }
    return { data: null, error: null };
  }
}

// FakeWorkoutsTable — captures the INSERT row.
class FakeWorkoutsTable {
  private _row: Record<string, unknown> | null = null;

  insert(row: Record<string, unknown>) {
    this._row = row;
    return this;
  }
  select() {
    return this;
  }
  async single() {
    if (mocks.nextInsertError) {
      const err = mocks.nextInsertError;
      mocks.nextInsertError = null;
      return { data: null, error: err };
    }
    mocks.lastInsert = this._row;
    return {
      data: {
        id: "new-workout-id",
        ...this._row,
        created_at: new Date().toISOString(),
      },
      error: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function invokeRoute(
  body: unknown,
  opts: { headers?: Record<string, string> } = {},
): Promise<Response> {
  const { POST } = await import("../../../app/api/coach/workouts/route");
  return POST(
    new Request("http://localhost:3000/api/coach/workouts", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
      body: JSON.stringify(body),
    }),
  );
}

const validBody = {
  athlete_id: "00000000-0000-0000-0000-000000000001",
  scheduled_date: "2026-06-15",
  sport: "run",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/coach/workouts", () => {
  beforeEach(() => {
    mocks.authUser = null;
    mocks.userRoleFlags = ["athlete"];
    mocks.activeLinks.clear();
    mocks.lastInsert = null;
    mocks.nextInsertError = null;
  });

  it("returns 401 when no authenticated user", async () => {
    const res = await invokeRoute(validBody);
    expect(res.status).toBe(401);
  });

  it("returns 401 with missing Bearer token", async () => {
    const res = await invokeRoute(validBody, { headers: {} });
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not a coach", async () => {
    mocks.authUser = { id: "user-athlete" };
    mocks.userRoleFlags = ["athlete"];

    const res = await invokeRoute(validBody, {
      headers: { Authorization: "Bearer valid-jwt" },
    });
    expect(res.status).toBe(403);
    expect(mocks.lastInsert).toBeNull();
  });

  it("returns 403 when coach is not linked to the target athlete", async () => {
    mocks.authUser = { id: "coach-unlinked" };
    mocks.userRoleFlags = ["coach"];
    // No link entry added to activeLinks.

    const res = await invokeRoute(validBody, {
      headers: { Authorization: "Bearer valid-jwt" },
    });
    expect(res.status).toBe(403);
    expect(mocks.lastInsert).toBeNull();
  });

  it("returns 400 for invalid sport value", async () => {
    mocks.authUser = { id: "coach-valid" };
    mocks.userRoleFlags = ["coach"];
    mocks.activeLinks.add(`coach-valid:${validBody.athlete_id}`);

    const res = await invokeRoute(
      { ...validBody, sport: "unicycle" },
      { headers: { Authorization: "Bearer valid-jwt" } },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing required fields", async () => {
    mocks.authUser = { id: "coach-valid" };
    mocks.userRoleFlags = ["coach"];

    const res = await invokeRoute(
      { athlete_id: validBody.athlete_id }, // missing scheduled_date, sport
      { headers: { Authorization: "Bearer valid-jwt" } },
    );
    expect(res.status).toBe(400);
  });

  it("returns 201 and creates workout for a linked coach", async () => {
    mocks.authUser = { id: "coach-happy" };
    mocks.userRoleFlags = ["coach"];
    mocks.activeLinks.add(`coach-happy:${validBody.athlete_id}`);

    const res = await invokeRoute(validBody, {
      headers: { Authorization: "Bearer coach-happy-jwt" },
    });
    expect(res.status).toBe(201);

    // Verify the inserted row shape.
    expect(mocks.lastInsert).toBeDefined();
    expect(mocks.lastInsert?.athlete_id).toBe(validBody.athlete_id);
    expect(mocks.lastInsert?.sport).toBe("run");
    expect(mocks.lastInsert?.edited_by_kind).toBe("coach");
    expect(mocks.lastInsert?.edited_by_user_id).toBe("coach-happy");
  });

  it("passes optional fields (structure, planned_load, rationale) to the insert", async () => {
    mocks.authUser = { id: "coach-opts" };
    mocks.userRoleFlags = ["coach"];
    mocks.activeLinks.add(`coach-opts:${validBody.athlete_id}`);

    const body = {
      ...validBody,
      structure: { intervals: 4, duration_s: 300 },
      planned_load: 85.5,
      rationale: "Tempo intervals for base building",
    };

    const res = await invokeRoute(body, {
      headers: { Authorization: "Bearer jwt" },
    });
    expect(res.status).toBe(201);
    expect(mocks.lastInsert?.structure).toEqual(body.structure);
    expect(mocks.lastInsert?.planned_load).toBe(85.5);
    expect(mocks.lastInsert?.rationale).toBe(body.rationale);
  });
});
