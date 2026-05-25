// Unit tests for POST /api/workouts/[id]/status.
//
// The route depends on:
// - @/auth/server.createClient (JWT SSR client) + resolveAuth (Bearer header)
// - @/db/admin.createAdminClient (service-role) for planned_workouts,
//   completed_workouts, workout_matches reads/writes and coach link checks.
//
// All Supabase calls are mocked via vi.mock so no DB connection is needed.
// The tests cover the five scenarios from the plan:
//   1. mark complete → creates completed_workout + workout_match → 200
//   2. mark skipped  → updates status → 200
//   3. workout not found → 404
//   4. athlete_id != auth.uid() and not linked coach → 403
//   5. missing Bearer → 401

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Must set env before any import that reads config.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
  process.env.STRAVA_OAUTH_STATE_SIGNING_KEY =
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  process.env.STRAVA_TOKEN_KEYS =
    "1:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  process.env.STRAVA_CLIENT_ID = "test-client-id";
  process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
  process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = "test-webhook-verify";
});

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

interface PlannedWorkoutStub {
  id: string;
  athlete_id: string;
  sport: string;
  scheduled_date: string;
  structure: Record<string, unknown>;
  status: string;
}

interface CoachLinkStub {
  id: string;
  coach_user_id: string;
  athlete_user_id: string;
  status: string;
  deleted_at: null;
}

interface CompletedWorkoutStub {
  id: string;
  athlete_id: string;
  source: string;
  started_at: string;
  sport: string;
  duration_s: number | null;
  distance_m: number | null;
  summary_stats: Record<string, unknown>;
}

interface WorkoutMatchStub {
  planned_workout_id: string;
  completed_workout_id: string;
  match_method: string;
  matched_at: string;
}

const db = {
  plannedWorkouts: new Map<string, PlannedWorkoutStub>(),
  coachLinks: [] as CoachLinkStub[],
  completedWorkouts: new Map<string, CompletedWorkoutStub>(),
  workoutMatches: [] as WorkoutMatchStub[],
  workoutEdits: [] as Record<string, unknown>[],
  // Control flags
  rpcShouldSucceed: false as boolean,
  nextRpcError: null as { code?: string; message: string } | null,
  nextInsertError: null as { message: string } | null,
};

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string; email?: string } | null,
}));

// ---------------------------------------------------------------------------
// Mock: auth/server
// ---------------------------------------------------------------------------

vi.mock("@/auth/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: (token?: string) => {
        if (!token) {
          // No bearer = not authenticated
          return Promise.resolve({ data: { user: null }, error: null });
        }
        return Promise.resolve({
          data: { user: mocks.authUser },
          error: null,
        });
      },
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock: db/admin
// ---------------------------------------------------------------------------

vi.mock("@/db/admin", () => ({
  createAdminClient: () => makeFakeAdmin(),
}));

function makeFakeAdmin() {
  return {
    from(table: string) {
      if (table === "planned_workouts") return new PlannedWorkoutsTable();
      if (table === "coach_athlete_links") return new CoachLinksTable();
      if (table === "completed_workouts") return new CompletedWorkoutsTable();
      if (table === "workout_matches") return new WorkoutMatchesTable();
      if (table === "workout_edits") return new WorkoutEditsTable();
      throw new Error(`unexpected table in test: ${table}`);
    },
    async rpc(
      fn: string,
      _args: Record<string, unknown>
    ): Promise<{ data: unknown; error: { message: string } | null }> {
      if (fn !== "complete_planned_workout") {
        return { data: null, error: { message: `unknown rpc: ${fn}` } };
      }
      if (db.nextRpcError) {
        const err = db.nextRpcError;
        db.nextRpcError = null;
        return { data: null, error: err };
      }
      if (db.rpcShouldSucceed) {
        return { data: null, error: null };
      }
      // Default: RPC not found (simulates environment without the function).
      return {
        data: null,
        error: { message: "function complete_planned_workout does not exist" },
      };
    },
  };
}

// --- WorkoutEditsTable fake ---
// The status route appends an append-only audit row (Unit 2) via
// appendWorkoutEdit: .insert({...}).select("id").single().
class WorkoutEditsTable {
  insert(row: Record<string, unknown>) {
    db.workoutEdits.push(row);
    return {
      select: (_cols: string) => ({
        single: async () => ({ data: { id: `we-${db.workoutEdits.length}` }, error: null }),
      }),
    };
  }
}

// --- PlannedWorkoutsTable fake ---
class PlannedWorkoutsTable {
  private _filter: { col: string; val: unknown }[] = [];

  select(_cols: string) {
    return this;
  }
  update(values: Record<string, unknown>) {
    // Apply the update to matching rows.
    void values; // captured in eq chain
    return new UpdateBuilder(values);
  }
  eq(col: string, val: unknown) {
    this._filter.push({ col, val });
    return this;
  }
  is(_col: string, _val: unknown) {
    return this;
  }
  async maybeSingle(): Promise<{
    data: PlannedWorkoutStub | null;
    error: null;
  }> {
    const idFilter = this._filter.find((f) => f.col === "id");
    if (!idFilter) return { data: null, error: null };
    const row = db.plannedWorkouts.get(idFilter.val as string) ?? null;
    return { data: row, error: null };
  }
}

class UpdateBuilder {
  constructor(private readonly values: Record<string, unknown>) {}
  private _filters: { col: string; val: unknown }[] = [];

  eq(col: string, val: unknown) {
    this._filters.push({ col, val });
    return this;
  }
  async then(
    resolve: (v: { data: null; error: null }) => void
  ): Promise<void> {
    const idFilter = this._filters.find((f) => f.col === "id");
    if (idFilter) {
      const row = db.plannedWorkouts.get(idFilter.val as string);
      if (row) {
        Object.assign(row, this.values);
      }
    }
    resolve({ data: null, error: null });
  }
}

// --- CoachLinksTable fake ---
class CoachLinksTable {
  private _filters: { col: string; val: unknown }[] = [];
  select(_cols: string) {
    return this;
  }
  eq(col: string, val: unknown) {
    this._filters.push({ col, val });
    return this;
  }
  is(_col: string, _val: unknown) {
    return this;
  }
  limit(_n: number) {
    return this;
  }
  async maybeSingle(): Promise<{
    data: CoachLinkStub | null;
    error: null;
  }> {
    const coachFilter = this._filters.find((f) => f.col === "coach_user_id");
    const athleteFilter = this._filters.find(
      (f) => f.col === "athlete_user_id"
    );
    const link = db.coachLinks.find(
      (l) =>
        l.coach_user_id === coachFilter?.val &&
        l.athlete_user_id === athleteFilter?.val &&
        l.status === "active" &&
        l.deleted_at === null
    );
    return { data: link ?? null, error: null };
  }
}

// --- CompletedWorkoutsTable fake ---
class CompletedWorkoutsTable {
  private _insertRow: CompletedWorkoutStub | null = null;

  insert(row: CompletedWorkoutStub) {
    this._insertRow = row;
    return this;
  }
  update(values: Record<string, unknown>) {
    void values;
    return new CompletedWorkoutsUpdateBuilder(values);
  }
  select(_cols: string) {
    return this;
  }
  async single(): Promise<{
    data: CompletedWorkoutStub | null;
    error: { message: string } | null;
  }> {
    if (db.nextInsertError) {
      const err = db.nextInsertError;
      db.nextInsertError = null;
      return { data: null, error: err };
    }
    if (!this._insertRow) return { data: null, error: { message: "no row" } };
    const id = `cw-${Date.now()}`;
    const row = { ...this._insertRow, id } as CompletedWorkoutStub;
    db.completedWorkouts.set(id, row);
    return { data: row, error: null };
  }
}

class CompletedWorkoutsUpdateBuilder {
  constructor(private readonly values: Record<string, unknown>) {}
  eq(_col: string, _val: unknown) {
    return this;
  }
  async then(resolve: (v: { data: null; error: null }) => void) {
    resolve({ data: null, error: null });
  }
}

// --- WorkoutMatchesTable fake ---
class WorkoutMatchesTable {
  private _insertRow: WorkoutMatchStub | null = null;

  insert(row: WorkoutMatchStub) {
    this._insertRow = row;
    return this;
  }
  async then(
    resolve: (v: { data: null; error: { message: string } | null }) => void
  ) {
    if (!this._insertRow) {
      resolve({ data: null, error: { message: "no match row" } });
      return;
    }
    db.workoutMatches.push(this._insertRow);
    resolve({ data: null, error: null });
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRequest(
  workoutId: string,
  body: unknown,
  token?: string
): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token !== undefined) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return new Request(
    `http://localhost/api/workouts/${workoutId}/status`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }
  );
}

async function callRoute(
  workoutId: string,
  body: unknown,
  token?: string
): Promise<Response> {
  // Lazy import so vi.mock registrations are in place first.
  const { POST } = await import(
    "@/../app/api/workouts/[id]/status/route"
  );
  const request = makeRequest(workoutId, body, token);
  return POST(request, { params: Promise.resolve({ id: workoutId }) });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
  db.plannedWorkouts.clear();
  db.coachLinks.length = 0;
  db.completedWorkouts.clear();
  db.workoutMatches.length = 0;
  db.workoutEdits.length = 0;
  db.rpcShouldSucceed = false;
  db.nextRpcError = null;
  db.nextInsertError = null;
  mocks.authUser = null;
});

afterEach(() => {
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/workouts/[id]/status — auth", () => {
  it("returns 401 when Bearer token is missing", async () => {
    const res = await callRoute("pw-1", { status: "skipped" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });
});

describe("POST /api/workouts/[id]/status — not found", () => {
  it("returns 404 when the workout does not exist", async () => {
    mocks.authUser = { id: "user-1" };
    // No planned workout in db.plannedWorkouts — maybeSingle returns null.
    const res = await callRoute("missing-id", { status: "skipped" }, "token");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });
});

describe("POST /api/workouts/[id]/status — authorization", () => {
  it("returns 403 when caller is not the athlete and not a linked coach", async () => {
    mocks.authUser = { id: "intruder-user" };
    db.plannedWorkouts.set("pw-owned", {
      id: "pw-owned",
      athlete_id: "athlete-1",
      sport: "run",
      scheduled_date: "2026-05-20",
      structure: {},
      status: "planned",
    });
    // No coach link — intruder is neither the owner nor a linked coach.

    const res = await callRoute(
      "pw-owned",
      { status: "skipped" },
      "token"
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("forbidden");
  });

  it("allows a linked coach to update status", async () => {
    mocks.authUser = { id: "coach-1" };
    db.plannedWorkouts.set("pw-owned", {
      id: "pw-owned",
      athlete_id: "athlete-1",
      sport: "run",
      scheduled_date: "2026-05-20",
      structure: {},
      status: "planned",
    });
    db.coachLinks.push({
      id: "link-1",
      coach_user_id: "coach-1",
      athlete_user_id: "athlete-1",
      status: "active",
      deleted_at: null,
    });

    const res = await callRoute(
      "pw-owned",
      { status: "skipped" },
      "token"
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/workouts/[id]/status — mark skipped", () => {
  it("updates planned_workout.status to skipped and returns 200", async () => {
    mocks.authUser = { id: "athlete-1" };
    db.plannedWorkouts.set("pw-1", {
      id: "pw-1",
      athlete_id: "athlete-1",
      sport: "run",
      scheduled_date: "2026-05-20",
      structure: {},
      status: "planned",
    });

    const res = await callRoute("pw-1", { status: "skipped" }, "token");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify the row was updated.
    const updatedRow = db.plannedWorkouts.get("pw-1");
    expect(updatedRow?.status).toBe("skipped");
  });
});

describe("POST /api/workouts/[id]/status — mark complete", () => {
  it("via RPC: returns 200 when RPC succeeds", async () => {
    mocks.authUser = { id: "athlete-1" };
    db.plannedWorkouts.set("pw-2", {
      id: "pw-2",
      athlete_id: "athlete-1",
      sport: "ride",
      scheduled_date: "2026-05-20",
      structure: {},
      status: "planned",
    });
    db.rpcShouldSucceed = true;

    const res = await callRoute(
      "pw-2",
      {
        status: "completed",
        duration_s: 3600,
        distance_m: 40000,
      },
      "token"
    );
    expect(res.status).toBe(200);
  });

  it("via fallback: creates completed_workout + workout_match when RPC not found", async () => {
    mocks.authUser = { id: "athlete-1" };
    db.plannedWorkouts.set("pw-3", {
      id: "pw-3",
      athlete_id: "athlete-1",
      sport: "swim",
      scheduled_date: "2026-05-21",
      structure: {},
      status: "planned",
    });
    // rpcShouldSucceed = false → route falls back to sequential inserts.

    const res = await callRoute(
      "pw-3",
      {
        status: "completed",
        duration_s: 1800,
      },
      "token"
    );
    expect(res.status).toBe(200);

    // A completed_workout row should have been inserted.
    expect(db.completedWorkouts.size).toBe(1);
    const [cw] = [...db.completedWorkouts.values()];
    expect(cw.athlete_id).toBe("athlete-1");
    expect(cw.sport).toBe("swim");
    expect(cw.duration_s).toBe(1800);

    // A workout_match row should have been inserted.
    expect(db.workoutMatches.length).toBe(1);
    expect(db.workoutMatches[0].planned_workout_id).toBe("pw-3");
  });

  it("returns 200 even without optional fields (duration/distance)", async () => {
    mocks.authUser = { id: "athlete-1" };
    db.plannedWorkouts.set("pw-4", {
      id: "pw-4",
      athlete_id: "athlete-1",
      sport: "strength",
      scheduled_date: "2026-05-22",
      structure: {},
      status: "planned",
    });

    const res = await callRoute(
      "pw-4",
      { status: "completed" },
      "token"
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/workouts/[id]/status — mark moved", () => {
  it("updates scheduled_date and status to moved", async () => {
    mocks.authUser = { id: "athlete-1" };
    db.plannedWorkouts.set("pw-5", {
      id: "pw-5",
      athlete_id: "athlete-1",
      sport: "run",
      scheduled_date: "2026-05-20",
      structure: {},
      status: "planned",
    });

    const res = await callRoute(
      "pw-5",
      {
        status: "moved",
        scheduled_date: "2026-05-25",
      },
      "token"
    );
    expect(res.status).toBe(200);

    const updated = db.plannedWorkouts.get("pw-5");
    expect(updated?.status).toBe("moved");
    expect(updated?.scheduled_date).toBe("2026-05-25");
  });

  it("returns 400 when scheduled_date is missing for moved status", async () => {
    mocks.authUser = { id: "athlete-1" };
    db.plannedWorkouts.set("pw-6", {
      id: "pw-6",
      athlete_id: "athlete-1",
      sport: "run",
      scheduled_date: "2026-05-20",
      structure: {},
      status: "planned",
    });

    const res = await callRoute(
      "pw-6",
      { status: "moved" }, // missing scheduled_date
      "token"
    );
    expect(res.status).toBe(400);
  });
});
