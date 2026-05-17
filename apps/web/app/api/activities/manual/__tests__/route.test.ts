// Unit tests for POST /api/activities/manual.
//
// The route depends on:
// - @/auth/server.createClient (user JWT client) + resolveAuth (Bearer header)
// - supabase.from('completed_workouts').insert().select().single()
//
// Both are mocked via vi.mock. No real DB or Strava calls are made.
//
// Test scenarios:
//   - Happy path: valid body → 201 with created completed_workout row.
//   - Missing sport → 400 invalid_input.
//   - Missing Bearer / unauthenticated → 401 unauthorized.
//   - duration_s ≤ 0 → 400 invalid_input.
//   - Missing started_at → 400 invalid_input.
//   - RLS failure (insert error from Supabase) → 500 insert_failed.
//   - Notes stored in summary_stats.notes.
//   - distance_m optional: absent → null in row.

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
  lastBearerToken: undefined as string | undefined,
  // The row the fake will return from .single(), or an error to inject.
  nextInsertResult: null as {
    data: Record<string, unknown> | null;
    error: { message: string; code?: string } | null;
  } | null,
  // Captures the row passed to .insert() for assertions.
  lastInsertedRow: null as Record<string, unknown> | null,
}));

// ---------------------------------------------------------------------------
// Fake Supabase client — user JWT path
// ---------------------------------------------------------------------------

function makeSupabaseFake() {
  return {
    auth: {
      getUser: (token?: string) => {
        mocks.lastBearerToken = token;
        return Promise.resolve({
          data: { user: mocks.authUser },
          error: null,
        });
      },
    },
    from: (table: string) => new TableFake(table),
  };
}

class TableFake {
  constructor(private readonly _table: string) {}

  insert(row: Record<string, unknown>) {
    if (this._table !== "completed_workouts") {
      throw new Error(`unexpected table: ${this._table}`);
    }
    mocks.lastInsertedRow = row;
    return new InsertBuilder(row);
  }
}

class InsertBuilder {
  constructor(private readonly _row: Record<string, unknown>) {}
  select() {
    return new InsertSelectBuilder(this._row);
  }
}

class InsertSelectBuilder {
  constructor(private readonly _row: Record<string, unknown>) {}
  async single() {
    const result = mocks.nextInsertResult;
    if (result) return result;
    // Default happy-path: echo the inserted row with a fake id + timestamps.
    return {
      data: {
        id: "cw-new-uuid",
        ...this._row,
        strava_activity_id: null,
        superseded_by_id: null,
        created_at: "2026-05-17T12:00:00.000Z",
        deleted_at: null,
      },
      error: null,
    };
  }
}

// ---------------------------------------------------------------------------
// vi.mock
// ---------------------------------------------------------------------------

vi.mock("@/auth/server", () => ({
  createClient: async () => makeSupabaseFake(),
}));

// ---------------------------------------------------------------------------
// Route invocation helper
// ---------------------------------------------------------------------------

async function invokeRoute(
  body: unknown,
  opts: { headers?: Record<string, string> } = {}
): Promise<Response> {
  // Dynamic import so vi.mock takes effect before module evaluation.
  const { POST } = await import("../route");
  return POST(
    new Request("http://localhost:3000/api/activities/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
      body: JSON.stringify(body),
    })
  );
}

function validBody(): Record<string, unknown> {
  return {
    sport: "run",
    started_at: "2026-05-17T08:00:00.000Z",
    duration_s: 3600,
    distance_m: 10500,
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mocks.authUser = null;
  mocks.lastBearerToken = undefined;
  mocks.nextInsertResult = null;
  mocks.lastInsertedRow = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/activities/manual", () => {
  // ------------------------------------------------------------------
  // Auth
  // ------------------------------------------------------------------

  it("returns 401 when there is no authenticated user (no Bearer)", async () => {
    const res = await invokeRoute(validBody());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("forwards Bearer token to supabase.auth.getUser", async () => {
    mocks.authUser = { id: "user-bearer" };
    const res = await invokeRoute(validBody(), {
      headers: { Authorization: "Bearer test-jwt" },
    });
    expect(res.status).toBe(201);
    expect(mocks.lastBearerToken).toBe("test-jwt");
  });

  // ------------------------------------------------------------------
  // Validation — missing / invalid fields
  // ------------------------------------------------------------------

  it("returns 400 invalid_input when sport is missing", async () => {
    mocks.authUser = { id: "user-1" };
    const { sport: _omit, ...noSport } = validBody();
    const res = await invokeRoute(noSport);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("returns 400 invalid_input when sport is not a recognised value", async () => {
    mocks.authUser = { id: "user-1" };
    const res = await invokeRoute({ ...validBody(), sport: "yoga" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("returns 400 invalid_input when duration_s is 0", async () => {
    mocks.authUser = { id: "user-1" };
    const res = await invokeRoute({ ...validBody(), duration_s: 0 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("returns 400 invalid_input when duration_s is negative", async () => {
    mocks.authUser = { id: "user-1" };
    const res = await invokeRoute({ ...validBody(), duration_s: -60 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("returns 400 invalid_input when started_at is missing", async () => {
    mocks.authUser = { id: "user-1" };
    const { started_at: _omit, ...noDate } = validBody();
    const res = await invokeRoute(noDate);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("returns 400 invalid_input when request body is not valid JSON", async () => {
    mocks.authUser = { id: "user-1" };
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost:3000/api/activities/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json{",
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  // ------------------------------------------------------------------
  // Happy path
  // ------------------------------------------------------------------

  it("happy path: valid body → 201 with new completed_workout row", async () => {
    mocks.authUser = { id: "user-happy" };

    const res = await invokeRoute(
      { ...validBody(), notes: "Morning run" },
      { headers: { Authorization: "Bearer jwt-happy" } }
    );

    expect(res.status).toBe(201);
    const responseBody = await res.json();
    expect(responseBody.id).toBe("cw-new-uuid");
    expect(responseBody.sport).toBe("run");
    expect(responseBody.athlete_id).toBe("user-happy");
    expect(responseBody.source).toBe("manual");
    expect(responseBody.duration_s).toBe(3600);
    expect(responseBody.distance_m).toBe(10500);
  });

  it("sets athlete_id from the authenticated user, not from the body", async () => {
    mocks.authUser = { id: "user-owner" };
    await invokeRoute(validBody());
    expect(mocks.lastInsertedRow?.athlete_id).toBe("user-owner");
  });

  it("notes are stored in summary_stats.notes", async () => {
    mocks.authUser = { id: "user-1" };
    await invokeRoute({ ...validBody(), notes: "Felt strong" });
    const stats = mocks.lastInsertedRow?.summary_stats as Record<string, unknown>;
    expect(stats?.notes).toBe("Felt strong");
  });

  it("omits notes from summary_stats when not provided", async () => {
    mocks.authUser = { id: "user-1" };
    await invokeRoute(validBody());
    const stats = mocks.lastInsertedRow?.summary_stats as Record<string, unknown>;
    expect(stats?.notes).toBeUndefined();
  });

  it("distance_m is optional — absent → null in inserted row", async () => {
    mocks.authUser = { id: "user-1" };
    const { distance_m: _omit, ...noDistance } = validBody();
    await invokeRoute(noDistance);
    expect(mocks.lastInsertedRow?.distance_m).toBeNull();
  });

  it("strength workout without distance is valid", async () => {
    mocks.authUser = { id: "user-1" };
    const res = await invokeRoute({
      sport: "strength",
      started_at: "2026-05-17T07:00:00.000Z",
      duration_s: 2700,
    });
    expect(res.status).toBe(201);
    expect(mocks.lastInsertedRow?.sport).toBe("strength");
    expect(mocks.lastInsertedRow?.distance_m).toBeNull();
  });

  // ------------------------------------------------------------------
  // DB error handling
  // ------------------------------------------------------------------

  it("returns 500 insert_failed when Supabase returns an error", async () => {
    mocks.authUser = { id: "user-1" };
    mocks.nextInsertResult = {
      data: null,
      error: { message: "RLS violation", code: "42501" },
    };
    const res = await invokeRoute(validBody());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("insert_failed");
  });
});
