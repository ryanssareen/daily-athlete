// Unit tests for POST /api/workouts/[id]/status (plan Unit 2).
//
// The route depends on:
//   - @/auth/server.createClient (user JWT client) + resolveAuth (Bearer / cookie)
//   - @/db/admin.createAdminClient (service-role client) for the
//     planned_workouts fetch/update, coach_athlete_links check,
//     complete_planned_workout RPC, and the workout_edits audit append.
//
// All Supabase access is mocked via a single fake admin client + a fake user
// client. No real DB and no `supabase start` (Docker-free, pure unit). The
// DB-backed RLS/version/append-only behavior is covered by the CI Postgres
// tests in src/db/__tests__/{workout-edits,planned-workouts-version}.*.
//
// Unit 2 focus — attribution + complete audit log:
//   - Athlete moves a workout -> row stamped edited_by_kind='athlete';
//     one workout_edits row (actor_role='athlete').
//   - Linked coach skips via the status route -> stamped 'coach';
//     workout_edits actor_role='coach', athlete_id = the workout owner.
//   - Complete via the RPC path -> attribution recorded + audit appended.
//
// Characterization note: the pre-Unit-2 behavior stamped only edited_at and
// never appended a workout_edits row. The assertions below lock in the new
// additive behavior (attribution columns present + exactly one audit append per
// edit) so a regression to the old unstamped behavior fails the suite.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

interface UpdateCall {
  table: string;
  patch: Record<string, unknown>;
  eqId: string | null;
}

const mocks = vi.hoisted(() => ({
  // Resolved auth user.
  authUser: null as { id: string } | null,
  // The planned_workouts row returned by the ownership fetch (null = 404).
  plannedWorkout: null as Record<string, unknown> | null,
  // Whether a coach_athlete_links row exists (the linked-coach check).
  coachLinked: false,
  // Whether the complete_planned_workout RPC "exists" / succeeds.
  rpcError: null as { message: string; code?: string } | null,
  // Captured planned_workouts.update() patches.
  updateCalls: [] as UpdateCall[],
  // Captured workout_edits.insert() rows (the audit appends).
  appendedEdits: [] as Record<string, unknown>[],
  // Captured RPC calls.
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
}));

// ---------------------------------------------------------------------------
// Fake user-JWT client (only auth.getUser is exercised via resolveAuth).
// ---------------------------------------------------------------------------

function makeUserClientFake() {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: mocks.authUser }, error: null }),
    },
  };
}

// ---------------------------------------------------------------------------
// Fake service-role admin client.
// ---------------------------------------------------------------------------

function makeAdminFake() {
  return {
    from(table: string) {
      return new TableFake(table);
    },
    rpc(fn: string, args: Record<string, unknown>) {
      mocks.rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: mocks.rpcError });
    },
  };
}

class TableFake {
  constructor(private readonly table: string) {}

  // --- SELECT chain (planned_workouts fetch + coach link check) ---
  select(_cols?: string) {
    return new SelectFake(this.table);
  }

  // --- UPDATE chain (planned_workouts attribution stamp) ---
  update(patch: Record<string, unknown>) {
    return new UpdateFake(this.table, patch);
  }

  // --- INSERT chain (workout_edits append) ---
  insert(row: Record<string, unknown>) {
    if (this.table === "workout_edits") {
      mocks.appendedEdits.push(row);
    }
    return new InsertFake(this.table, row);
  }
}

class SelectFake {
  private filters: Record<string, unknown> = {};
  constructor(private readonly table: string) {}
  eq(col: string, val: unknown) {
    this.filters[col] = val;
    return this;
  }
  is() {
    return this;
  }
  limit() {
    return this;
  }
  async maybeSingle() {
    if (this.table === "planned_workouts") {
      return { data: mocks.plannedWorkout, error: null };
    }
    if (this.table === "coach_athlete_links") {
      return {
        data: mocks.coachLinked ? { id: "link-1" } : null,
        error: null,
      };
    }
    return { data: null, error: null };
  }
}

class UpdateFake {
  constructor(
    private readonly table: string,
    private readonly patch: Record<string, unknown>,
  ) {}
  async eq(_col: string, val: unknown) {
    mocks.updateCalls.push({
      table: this.table,
      patch: this.patch,
      eqId: typeof val === "string" ? val : null,
    });
    return { data: null, error: null };
  }
}

class InsertFake {
  constructor(
    private readonly table: string,
    private readonly _row: Record<string, unknown>,
  ) {}
  select() {
    const table = this.table;
    return {
      async single() {
        return { data: { id: `${table}-new` }, error: null };
      },
    };
  }
  // Some writers (workout_matches insert, completed_workouts undo) await the
  // builder directly without .select().single(); make it a thenable resolving
  // to a no-error result so those destructures work.
  then(
    resolve: (v: { data: null; error: null }) => unknown,
  ) {
    return Promise.resolve({ data: null, error: null }).then(resolve);
  }
}

// ---------------------------------------------------------------------------
// vi.mock
// ---------------------------------------------------------------------------

vi.mock("@/auth/server", () => ({
  createClient: async () => makeUserClientFake(),
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => makeAdminFake(),
}));

// ---------------------------------------------------------------------------
// Route invocation helper
// ---------------------------------------------------------------------------

async function invokeRoute(
  workoutId: string,
  body: unknown,
  opts: { headers?: Record<string, string> } = {},
): Promise<Response> {
  const { POST } = await import("../route");
  return POST(
    new Request(`http://localhost:3000/api/workouts/${workoutId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: workoutId }) },
  );
}

function plannedRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "pw-1",
    athlete_id: "athlete-1",
    sport: "run",
    scheduled_date: "2026-06-01",
    structure: {},
    status: "planned",
    ...over,
  };
}

// Convenience accessors over captured calls.
function plannedWorkoutPatches() {
  return mocks.updateCalls.filter((c) => c.table === "planned_workouts");
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mocks.authUser = null;
  mocks.plannedWorkout = null;
  mocks.coachLinked = false;
  mocks.rpcError = null;
  mocks.updateCalls = [];
  mocks.appendedEdits = [];
  mocks.rpcCalls = [];
});

// ---------------------------------------------------------------------------
// Auth / authorization
// ---------------------------------------------------------------------------

describe("POST /api/workouts/[id]/status — auth", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await invokeRoute("pw-1", { status: "skipped" });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the workout does not exist", async () => {
    mocks.authUser = { id: "athlete-1" };
    mocks.plannedWorkout = null;
    const res = await invokeRoute("pw-1", { status: "skipped" });
    expect(res.status).toBe(404);
  });

  it("returns 403 when caller is neither owner nor a linked coach", async () => {
    mocks.authUser = { id: "stranger" };
    mocks.plannedWorkout = plannedRow();
    mocks.coachLinked = false;
    const res = await invokeRoute("pw-1", { status: "skipped" });
    expect(res.status).toBe(403);
    // No edit should be stamped or appended on a forbidden call.
    expect(plannedWorkoutPatches()).toHaveLength(0);
    expect(mocks.appendedEdits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Athlete move — attribution + audit (plan Unit 2 scenario)
// ---------------------------------------------------------------------------

describe("POST /api/workouts/[id]/status — athlete move", () => {
  it("stamps edited_by_kind='athlete' and appends one athlete audit row", async () => {
    mocks.authUser = { id: "athlete-1" };
    mocks.plannedWorkout = plannedRow();

    const res = await invokeRoute("pw-1", {
      status: "moved",
      scheduled_date: "2026-06-05",
    });
    expect(res.status).toBe(200);

    // Attribution stamped on planned_workouts.
    const patches = plannedWorkoutPatches();
    expect(patches).toHaveLength(1);
    expect(patches[0].patch).toMatchObject({
      status: "moved",
      scheduled_date: "2026-06-05",
      edited_by_kind: "athlete",
      edited_by_user_id: "athlete-1",
    });
    expect(patches[0].patch.edited_at).toBeTypeOf("string");

    // Exactly one workout_edits audit row, attributed to the athlete.
    expect(mocks.appendedEdits).toHaveLength(1);
    expect(mocks.appendedEdits[0]).toMatchObject({
      athlete_id: "athlete-1",
      planned_workout_id: "pw-1",
      actor_role: "athlete",
      actor_user_id: "athlete-1",
      weekly_review_id: null,
    });
    // The diff captures the plannable change (scheduled_date).
    const diff = mocks.appendedEdits[0].field_diff as Record<string, unknown>;
    expect(diff.scheduled_date).toEqual({ from: "2026-06-01", to: "2026-06-05" });
  });
});

// ---------------------------------------------------------------------------
// Coach skip via the status route — attribution + audit (plan Unit 2 scenario)
// ---------------------------------------------------------------------------

describe("POST /api/workouts/[id]/status — linked coach skip", () => {
  it("stamps edited_by_kind='coach' and appends a coach audit row", async () => {
    mocks.authUser = { id: "coach-9" };
    mocks.plannedWorkout = plannedRow(); // owned by athlete-1
    mocks.coachLinked = true;

    const res = await invokeRoute("pw-1", { status: "skipped" });
    expect(res.status).toBe(200);

    const patches = plannedWorkoutPatches();
    expect(patches).toHaveLength(1);
    expect(patches[0].patch).toMatchObject({
      status: "skipped",
      edited_by_kind: "coach",
      edited_by_user_id: "coach-9",
    });

    expect(mocks.appendedEdits).toHaveLength(1);
    expect(mocks.appendedEdits[0]).toMatchObject({
      // athlete_id is the workout owner, NOT the coach.
      athlete_id: "athlete-1",
      planned_workout_id: "pw-1",
      actor_role: "coach",
      actor_user_id: "coach-9",
      weekly_review_id: null,
    });
    const diff = mocks.appendedEdits[0].field_diff as Record<string, unknown>;
    expect(diff.status).toEqual({ from: "planned", to: "skipped" });
  });
});

// ---------------------------------------------------------------------------
// Complete via the RPC path — attribution + audit (plan Unit 2 scenario)
// ---------------------------------------------------------------------------

describe("POST /api/workouts/[id]/status — complete via RPC", () => {
  it("calls the RPC, then stamps attribution and appends an audit row", async () => {
    mocks.authUser = { id: "athlete-1" };
    mocks.plannedWorkout = plannedRow();
    mocks.rpcError = null; // RPC succeeds

    const res = await invokeRoute("pw-1", {
      status: "completed",
      started_at: "2026-06-01T08:00:00.000Z",
      duration_s: 3600,
    });
    expect(res.status).toBe(200);

    // RPC was used.
    expect(mocks.rpcCalls).toHaveLength(1);
    expect(mocks.rpcCalls[0].fn).toBe("complete_planned_workout");

    // Attribution stamped AFTER the RPC (the RPC sets status but not attribution).
    const patches = plannedWorkoutPatches();
    expect(patches).toHaveLength(1);
    expect(patches[0].patch).toMatchObject({
      status: "completed",
      edited_by_kind: "athlete",
      edited_by_user_id: "athlete-1",
    });

    // Audit row appended for the RPC path.
    expect(mocks.appendedEdits).toHaveLength(1);
    expect(mocks.appendedEdits[0]).toMatchObject({
      athlete_id: "athlete-1",
      planned_workout_id: "pw-1",
      actor_role: "athlete",
      actor_user_id: "athlete-1",
    });
    const diff = mocks.appendedEdits[0].field_diff as Record<string, unknown>;
    expect(diff.status).toEqual({ from: "planned", to: "completed" });
  });

  it("falls back to manual inserts when the RPC is unavailable, still stamping + auditing", async () => {
    mocks.authUser = { id: "athlete-1" };
    mocks.plannedWorkout = plannedRow();
    // Simulate RPC-not-found so the fallback insert path runs.
    mocks.rpcError = { message: "function not found", code: "PGRST202" };

    const res = await invokeRoute("pw-1", {
      status: "completed",
      duration_s: 1800,
    });
    expect(res.status).toBe(200);

    // Attribution + audit still happen on the fallback path.
    const patches = plannedWorkoutPatches();
    expect(patches.length).toBeGreaterThanOrEqual(1);
    const completePatch = patches.find(
      (p) => p.patch.status === "completed" && p.patch.edited_by_kind === "athlete",
    );
    expect(completePatch).toBeDefined();
    expect(mocks.appendedEdits).toHaveLength(1);
    expect(mocks.appendedEdits[0].actor_role).toBe("athlete");
  });
});
