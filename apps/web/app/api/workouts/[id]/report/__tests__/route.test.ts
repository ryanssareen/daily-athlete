// Unit tests for GET/POST /api/workouts/[id]/report (Unit U6,
// docs/plans/2026-08-18-001-feat-workout-reports-plan.md).
//
// Mirrors app/api/plans/__tests__/route.test.ts's harness: module-level
// vi.mock of the route's dependencies (auth, context gathering, the LLM
// boundary, the admin client), no real DB / LLM / network anywhere in this
// file.
//
// THE CLIENT SPLIT THE FAKES ENFORCE: the route uses the @supabase/ssr client
// for AUTH ONLY and the service-role client for ALL DATA. `makeAuthClientFake`
// therefore exposes `auth` and NOTHING else — a `.from()` on it throws, so a
// regression that reads data under the auth client fails loudly here instead
// of silently 404ing only for cookie-less (mobile) callers, which is exactly
// how the original bug escaped review. The Bearer-path tests below then prove
// the cookie-less case end to end: no cookies at all, a Bearer header, and
// real rows come back.
//
// `gatherReportContext` (U4, does real I/O) and `narrate` (U5, does a real
// LLM call) are mocked; `computeExecutionDelta` (U3), `computeFingerprint`
// and `buildFactSheet` are left REAL (pure functions) so these tests
// exercise the actual U6 composition/wiring, not a re-mock of it.
//
// THE LOAD-BEARING ASSERTION (KTD2): every GET test below asserts
// `mocks.createLlmClientCalls === 0` AND `mocks.narrateCalls` is empty —
// the read path must NEVER invoke the LLM boundary, full stop.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

import type { ReportContext } from "@/ai/reports/context";
import { CompletedWorkoutNotFoundError } from "@/ai/reports/context";
import { computeFingerprint } from "@/ai/reports/fingerprint";
import { ReportNarrationInvalidError } from "@/ai/reports/narrate";
import { LlmInvalidOutput, LlmRateLimited, LlmTransient } from "@/llm";
import type { ReportNarration } from "@da2/shared";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

const ATHLETE = "00000000-0000-0000-0000-0000000000a1";
const WORKOUT_ID = "00000000-0000-0000-0000-0000000000w1";

interface UpsertCall {
  row: Record<string, unknown>;
  opts: Record<string, unknown>;
}

const OTHER_ATHLETE = "00000000-0000-0000-0000-0000000000a2";
const BEARER_TOKEN = "mobile-access-token";

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  /** Every token `auth.getUser(token)` was called with, so the Bearer tests
   * can prove the header actually reached supabase-js (undefined = cookie). */
  getUserTokens: [] as (string | undefined)[],
  // gatherReportContext control: either returns this context or throws this error.
  context: null as ReportContext | null,
  contextThrows: null as Error | null,
  gatherReportContextCalls: [] as unknown[],
  // workout_reports SELECT, read under the SERVICE-ROLE client.
  storedReportRow: null as Record<string, unknown> | null,
  storedReportReadError: null as { message: string } | null,
  /** Filters the route applied to each workout_reports SELECT — the
   * athlete-scoping assertions read these. */
  storedReportSelectFilters: [] as Record<string, unknown>[],
  // Generation-quota COUNT (POST path).
  quotaCount: 0,
  quotaCountError: null as { message: string } | null,
  quotaCountCalls: [] as Record<string, unknown>[],
  // narrate() control (POST path).
  narrateResult: null as ReportNarration | null,
  narrateThrows: null as Error | null,
  narrateCalls: [] as unknown[],
  createLlmClientCalls: 0,
  // workout_reports UPSERT (POST path), simulated with ON CONFLICT
  // (completed_workout_id) semantics: a Map keyed by completed_workout_id,
  // so a second upsert overwrites rather than duplicates.
  reportsByWorkoutId: new Map<string, Record<string, unknown>>(),
  upsertCalls: [] as UpsertCall[],
  upsertError: null as { message: string } | null,
  /** Non-zero when the route wrote without ON CONFLICT and the simulated
   * unique index rejected it — see the upsert fake. */
  duplicateKeyWrites: 0,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function unmatchedContext(): ReportContext {
  return {
    athleteId: ATHLETE,
    completedWorkout: {
      id: WORKOUT_ID,
      sport: "ride",
      started_at: "2026-08-10T12:00:00Z",
      distance_m: 8000,
      duration_s: 1320,
      summary_stats: {},
      superseded_by_id: null,
    },
    match: null,
    profile: null,
    plan: null,
    recentLoad: { series: [], ctl: 42, atl: 38, tsb: 4, ctlRampPerWeek: 1, powerConfidenceRatio: 0.9 },
  };
}

function matchedContext(): ReportContext {
  return {
    athleteId: ATHLETE,
    completedWorkout: {
      id: WORKOUT_ID,
      sport: "ride",
      started_at: "2026-08-10T12:00:00Z",
      distance_m: 20000,
      duration_s: 3480,
      summary_stats: { tss: 61 },
      superseded_by_id: null,
    },
    match: {
      id: "pw-1",
      scheduled_date: "2026-08-10",
      sport: "ride",
      status: "completed",
      structure: { duration_s: 3600, load: 55 },
      planned_load: 55,
      duration_s: 3600,
      load: 55,
      intensity_target: null,
      match: { id: "match-1", confidence: 0.9, method: "auto_same_day_sport", matched_at: "2026-08-10T13:00:00Z" },
    },
    profile: null,
    plan: null,
    recentLoad: { series: [], ctl: 42, atl: 38, tsb: 4, ctlRampPerWeek: 1, powerConfidenceRatio: 0.9 },
  };
}

const NARRATION: ReportNarration = { note: "Solid session, right in the zone.", takeaway: "Repeat next week." };

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/**
 * The @supabase/ssr client. AUTH SURFACE ONLY — `.from()` throws. See the
 * file header: the route must never read data under this client, because a
 * Bearer token validated by `auth.getUser(token)` is NOT attached to it.
 */
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
        `route read table "${table}" under the AUTH client — data must go through the ` +
          "service-role client, or cookie-less Bearer (mobile) callers query as anon and get zero rows"
      );
    },
  };
}

/** Chainable stand-in for a PostgREST filter builder. Records every filter so
 * tests can assert the athlete scoping, then resolves to the stubbed result. */
class QueryFake {
  readonly filters: Record<string, unknown> = {};
  private readonly headCount: boolean;

  constructor(
    private readonly resolve: (filters: Record<string, unknown>) => { data?: unknown; error: unknown; count?: number },
    opts: { head?: boolean } = {}
  ) {
    this.headCount = opts.head === true;
  }

  select(_cols: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) return this;
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters[col] = value;
    return this;
  }
  is(col: string, value: unknown) {
    this.filters[col] = value;
    return this;
  }
  gte(col: string, value: unknown) {
    this.filters[`gte:${col}`] = value;
    return this;
  }
  async maybeSingle() {
    return this.resolve(this.filters);
  }
  // A head/count query is awaited directly, with no terminal method.
  then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
    if (!this.headCount) {
      return Promise.resolve(this.resolve(this.filters)).then(onFulfilled, onRejected);
    }
    return Promise.resolve(this.resolve(this.filters)).then(onFulfilled, onRejected);
  }
}

function makeAdminFake() {
  return {
    from(table: string) {
      if (table !== "workout_reports") throw new Error(`unexpected table on admin client: ${table}`);
      return {
        select(cols: string, opts?: { count?: string; head?: boolean }) {
          // The quota guard is the only head/count read on this table.
          if (opts?.head) {
            const q = new QueryFake((filters) => {
              mocks.quotaCountCalls.push(filters);
              return { error: mocks.quotaCountError, count: mocks.quotaCount };
            }, { head: true });
            return q;
          }
          const q = new QueryFake((filters) => {
            mocks.storedReportSelectFilters.push(filters);
            // Athlete scoping is enforced by the FAKE, not merely asserted:
            // a query for the wrong athlete reads as "no row", exactly as
            // Postgres would with the explicit filter in place.
            if (filters.athlete_id !== undefined && filters.athlete_id !== ATHLETE) {
              return { data: null, error: null };
            }
            return { data: mocks.storedReportRow, error: mocks.storedReportReadError };
          });
          void cols;
          return q;
        },
        upsert(row: Record<string, unknown>, opts: Record<string, unknown>) {
          mocks.upsertCalls.push({ row, opts });
          if (mocks.upsertError) {
            return Promise.resolve({ error: mocks.upsertError });
          }
          const key = row.completed_workout_id as string;
          // Model the DB honestly rather than assuming the route did the
          // right thing. WITHOUT `onConflict`, supabase-js sends a plain
          // INSERT and `workout_reports_completed_workout_unique` rejects the
          // second write — so record that as a duplicate-key error instead of
          // silently collapsing onto one key. This is what gives the
          // concurrent-POST test teeth: previously the fake's `Map.set` made
          // "exactly one row" true no matter what the route passed.
          if (opts.onConflict !== "completed_workout_id") {
            if (mocks.reportsByWorkoutId.has(key)) {
              mocks.duplicateKeyWrites += 1;
              return Promise.resolve({
                error: { message: "duplicate key value violates unique constraint" },
              });
            }
            mocks.reportsByWorkoutId.set(key, row);
            return Promise.resolve({ error: null });
          }
          // ON CONFLICT (completed_workout_id) DO UPDATE: overwrite by key.
          mocks.reportsByWorkoutId.set(key, row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// vi.mock — real modules spread, only the I/O-touching exports overridden.
// ---------------------------------------------------------------------------

vi.mock("@/auth/server", () => ({
  createClient: async () => makeAuthClientFake(),
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => makeAdminFake(),
}));

vi.mock("@/ai/reports/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ai/reports/context")>();
  return {
    ...actual,
    gatherReportContext: vi.fn(async (args: unknown) => {
      mocks.gatherReportContextCalls.push(args);
      if (mocks.contextThrows) throw mocks.contextThrows;
      return mocks.context;
    }),
  };
});

vi.mock("@/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/llm")>();
  return {
    ...actual,
    createLlmClient: vi.fn(() => {
      mocks.createLlmClientCalls += 1;
      return { generateStructured: vi.fn() };
    }),
  };
});

vi.mock("@/ai/reports/narrate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ai/reports/narrate")>();
  return {
    ...actual,
    narrate: vi.fn(async (...args: unknown[]) => {
      mocks.narrateCalls.push(args);
      if (mocks.narrateThrows) throw mocks.narrateThrows;
      if (mocks.narrateResult) return mocks.narrateResult;
      throw new Error("narrate() called without a stubbed result in this test");
    }),
  };
});

// ---------------------------------------------------------------------------
// Invocation helpers
// ---------------------------------------------------------------------------

/** `bearer` mimics the mobile caller: an Authorization header and NO cookies. */
async function invokeGet(workoutId = WORKOUT_ID, opts: { bearer?: string } = {}): Promise<Response> {
  const { GET } = await import("../route");
  const headers = opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : undefined;
  return GET(new Request(`http://localhost:3000/api/workouts/${workoutId}/report`, { headers }), {
    params: Promise.resolve({ id: workoutId }),
  });
}

async function invokePost(workoutId = WORKOUT_ID, opts: { bearer?: string } = {}): Promise<Response> {
  const { POST } = await import("../route");
  const headers = opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : undefined;
  return POST(
    new Request(`http://localhost:3000/api/workouts/${workoutId}/report`, { method: "POST", headers }),
    { params: Promise.resolve({ id: workoutId }) }
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authUser = { id: ATHLETE };
  mocks.getUserTokens = [];
  mocks.context = matchedContext();
  mocks.contextThrows = null;
  mocks.gatherReportContextCalls = [];
  mocks.storedReportRow = null;
  mocks.storedReportReadError = null;
  mocks.storedReportSelectFilters = [];
  mocks.quotaCount = 0;
  mocks.quotaCountError = null;
  mocks.quotaCountCalls = [];
  mocks.narrateResult = NARRATION;
  mocks.narrateThrows = null;
  mocks.narrateCalls = [];
  mocks.createLlmClientCalls = 0;
  mocks.reportsByWorkoutId = new Map();
  mocks.upsertCalls = [];
  mocks.upsertError = null;
  mocks.duplicateKeyWrites = 0;
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("auth", () => {
  it("GET unauthenticated -> 401", async () => {
    mocks.authUser = null;
    const res = await invokeGet();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("POST unauthenticated -> 401", async () => {
    mocks.authUser = null;
    const res = await invokePost();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });
});

// ---------------------------------------------------------------------------
// Not-found posture (cross-athlete workout -> 404, not 403)
// ---------------------------------------------------------------------------

describe("ownership -> 404 (not 403)", () => {
  it("GET for another athlete's workout -> 404", async () => {
    mocks.contextThrows = new CompletedWorkoutNotFoundError(WORKOUT_ID);
    const res = await invokeGet();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("POST for another athlete's workout -> 404", async () => {
    mocks.contextThrows = new CompletedWorkoutNotFoundError(WORKOUT_ID);
    const res = await invokePost();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
    expect(mocks.narrateCalls).toHaveLength(0);
    expect(mocks.upsertCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET — never calls the LLM (KTD2)
// ---------------------------------------------------------------------------

describe("GET — never invokes the LLM", () => {
  it("no stored report -> 200, delta present, narration null, generatable true, zero LLM calls", async () => {
    mocks.context = matchedContext();
    mocks.storedReportRow = null;

    const res = await invokeGet();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.delta.matched).toBe(true);
    expect(body.delta.verdict.code).toBeTruthy();
    expect(body.narration).toBeNull();
    expect(body.stale).toBe(false);
    expect(body.generatable).toBe(true);

    // THE load-bearing assertion: GET never touches the LLM boundary.
    expect(mocks.createLlmClientCalls).toBe(0);
    expect(mocks.narrateCalls).toHaveLength(0);
  });

  it("stored report, fingerprint matches -> 200, narration present, stale false, zero LLM calls", async () => {
    const context = matchedContext();
    mocks.context = context;
    const fingerprint = computeFingerprint(context);
    mocks.storedReportRow = {
      narrative: "Great session.",
      takeaway: "Keep it up.",
      input_fingerprint: fingerprint,
    };

    const res = await invokeGet();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.narration).toEqual({ note: "Great session.", takeaway: "Keep it up." });
    expect(body.stale).toBe(false);
    expect(body.generatable).toBe(true);

    expect(mocks.createLlmClientCalls).toBe(0);
    expect(mocks.narrateCalls).toHaveLength(0);
  });

  // Covers AE5.
  it("stored report, fingerprint differs -> 200, narration present, stale true, zero LLM calls", async () => {
    mocks.context = matchedContext();
    mocks.storedReportRow = {
      narrative: "Old narrative from before enrichment landed.",
      takeaway: "Old takeaway.",
      input_fingerprint: "a-stale-fingerprint-that-does-not-match",
    };

    const res = await invokeGet();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.narration).toEqual({
      note: "Old narrative from before enrichment landed.",
      takeaway: "Old takeaway.",
    });
    expect(body.stale).toBe(true);
    expect(body.generatable).toBe(true);

    expect(mocks.createLlmClientCalls).toBe(0);
    expect(mocks.narrateCalls).toHaveLength(0);
  });

  // Covers AE3.
  it("unmatched workout -> 200, matched: false, no comparison block, no error, zero LLM calls", async () => {
    mocks.context = unmatchedContext();
    mocks.storedReportRow = null;

    const res = await invokeGet();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.delta.matched).toBe(false);
    expect(body.delta).not.toHaveProperty("dimensions");
    expect(body.delta.verdict.code).toBe("unplanned_effort");
    expect(body.narration).toBeNull();

    expect(mocks.createLlmClientCalls).toBe(0);
    expect(mocks.narrateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST — generation + persistence
// ---------------------------------------------------------------------------

describe("POST — generation", () => {
  it("no existing row -> row inserted (upserted), narration returned", async () => {
    mocks.context = matchedContext();
    mocks.narrateResult = NARRATION;

    const res = await invokePost();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.narration).toEqual(NARRATION);
    expect(body.stale).toBe(false);
    expect(body.generatable).toBe(true);
    expect(body.delta.matched).toBe(true);

    expect(mocks.upsertCalls).toHaveLength(1);
    const call = mocks.upsertCalls[0];
    expect(call.row.athlete_id).toBe(ATHLETE);
    expect(call.row.completed_workout_id).toBe(WORKOUT_ID);
    expect(call.row.narrative).toBe(NARRATION.note);
    expect(call.row.takeaway).toBe(NARRATION.takeaway);
    expect(call.opts.onConflict).toBe("completed_workout_id");
    expect(mocks.reportsByWorkoutId.size).toBe(1);
  });

  it("existing row -> updated in place, not duplicated", async () => {
    mocks.context = matchedContext();
    mocks.reportsByWorkoutId.set(WORKOUT_ID, {
      athlete_id: ATHLETE,
      completed_workout_id: WORKOUT_ID,
      narrative: "Old.",
      takeaway: "Old takeaway.",
    });
    mocks.narrateResult = NARRATION;

    const res = await invokePost();
    expect(res.status).toBe(200);
    expect(mocks.upsertCalls).toHaveLength(1);
    expect(mocks.reportsByWorkoutId.size).toBe(1);
    expect(mocks.reportsByWorkoutId.get(WORKOUT_ID)?.narrative).toBe(NARRATION.note);
  });

  // Covers AE6.
  it("LlmRateLimited -> 200, narration null, retryable true, no row written", async () => {
    mocks.context = matchedContext();
    mocks.narrateThrows = new LlmRateLimited("rate limited");

    const res = await invokePost();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.narration).toBeNull();
    expect(body.retryable).toBe(true);
    expect(body.delta.matched).toBe(true);
    expect(mocks.upsertCalls).toHaveLength(0);
  });

  it("LlmTransient -> 200, narration null, retryable true, no row written", async () => {
    mocks.context = matchedContext();
    mocks.narrateThrows = new LlmTransient("transient failure");

    const res = await invokePost();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.narration).toBeNull();
    expect(body.retryable).toBe(true);
    expect(mocks.upsertCalls).toHaveLength(0);
  });

  it("LlmInvalidOutput -> 200, narration null, retryable false, no row written", async () => {
    mocks.context = matchedContext();
    mocks.narrateThrows = new LlmInvalidOutput("unparseable");

    const res = await invokePost();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.narration).toBeNull();
    expect(body.retryable).toBe(false);
    expect(mocks.upsertCalls).toHaveLength(0);
  });

  it("ReportNarrationInvalidError (schema-rejected model output) -> 200, retryable false, no row written", async () => {
    mocks.context = matchedContext();
    mocks.narrateThrows = new ReportNarrationInvalidError("missing takeaway");

    const res = await invokePost();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.narration).toBeNull();
    expect(body.retryable).toBe(false);
    expect(mocks.upsertCalls).toHaveLength(0);
  });

  it("two concurrent POSTs for the same workout -> exactly one row afterward", async () => {
    mocks.context = matchedContext();
    mocks.narrateResult = NARRATION;

    const [res1, res2] = await Promise.all([invokePost(), invokePost()]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    expect(mocks.upsertCalls).toHaveLength(2);
    expect(mocks.upsertCalls.every((c) => c.opts.onConflict === "completed_workout_id")).toBe(true);
    // ON CONFLICT semantics collapse both writes onto one key. The fake only
    // reaches this state because the route passed onConflict — dropping it
    // would have produced a duplicate-key error on the second write.
    expect(mocks.reportsByWorkoutId.size).toBe(1);
    expect(mocks.duplicateKeyWrites).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bearer (mobile) path — no cookies anywhere in these requests.
//
// THE REGRESSION THESE EXIST FOR: `resolveAuth` calls
// `supabase.auth.getUser(bearerToken)`, which validates the token but does
// NOT attach it to the client. When the route then read DATA under that same
// @supabase/ssr client, a cookie-less request queried Postgres as `anon`,
// `auth.uid()` was NULL, and every RLS-scoped read returned zero rows — so
// every mobile report request 404'd while the browser worked fine. The old
// tests could not catch it because they mocked `@/auth/server` wholesale and
// never distinguished the two clients. `makeAuthClientFake().from()` now
// throws, and these tests drive the actual Bearer header through.
// ---------------------------------------------------------------------------

describe("Bearer auth (mobile, no cookies)", () => {
  it("GET with a Bearer token and no cookies -> 200 with real data", async () => {
    mocks.context = matchedContext();
    const fingerprint = computeFingerprint(mocks.context);
    mocks.storedReportRow = {
      narrative: "Nice work.",
      takeaway: "Again next week.",
      verdict_code: "executed_as_prescribed",
      input_fingerprint: fingerprint,
    };

    const res = await invokeGet(WORKOUT_ID, { bearer: BEARER_TOKEN });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.delta.matched).toBe(true);
    expect(body.narration).toEqual({ note: "Nice work.", takeaway: "Again next week." });
    // The header actually reached supabase-js.
    expect(mocks.getUserTokens).toEqual([BEARER_TOKEN]);
  });

  it("POST with a Bearer token and no cookies -> 200 and a row written", async () => {
    mocks.context = matchedContext();
    mocks.narrateResult = NARRATION;

    const res = await invokePost(WORKOUT_ID, { bearer: BEARER_TOKEN });
    expect(res.status).toBe(200);
    expect((await res.json()).narration).toEqual(NARRATION);
    expect(mocks.upsertCalls).toHaveLength(1);
    expect(mocks.getUserTokens).toEqual([BEARER_TOKEN]);
  });

  it("a cookie request passes no token to getUser (the browser path still works)", async () => {
    await invokeGet();
    expect(mocks.getUserTokens).toEqual([undefined]);
  });
});

// ---------------------------------------------------------------------------
// Athlete scoping on the stored-report read
// ---------------------------------------------------------------------------

describe("workout_reports read is athlete-scoped", () => {
  it("GET filters the stored-report read by athlete_id AND completed_workout_id", async () => {
    await invokeGet();
    expect(mocks.storedReportSelectFilters).toHaveLength(1);
    expect(mocks.storedReportSelectFilters[0]).toMatchObject({
      athlete_id: ATHLETE,
      completed_workout_id: WORKOUT_ID,
      deleted_at: null,
    });
  });

  it("a different authenticated athlete does not read this workout's stored narrative", async () => {
    // The workout itself is still resolvable in this fixture (gatherReportContext
    // is mocked), so this isolates the stored-report read's own scoping: the
    // fake returns no row once athlete_id stops matching.
    mocks.authUser = { id: OTHER_ATHLETE };
    mocks.storedReportRow = {
      narrative: "Someone else's note.",
      takeaway: "Someone else's takeaway.",
      verdict_code: "executed_as_prescribed",
      input_fingerprint: "whatever",
    };

    const res = await invokeGet();
    expect(res.status).toBe(200);
    expect((await res.json()).narration).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET degrades rather than 500s when the OPTIONAL narrative read fails
// ---------------------------------------------------------------------------

describe("GET — optional narrative read failure degrades", () => {
  it("workout_reports read error -> 200 with the delta intact, narration null", async () => {
    mocks.context = matchedContext();
    mocks.storedReportReadError = { message: "connection reset" };

    const res = await invokeGet();
    expect(res.status).toBe(200);
    const body = await res.json();

    // The whole point: the deterministic half survives a failure of the
    // optional half. A 500 here would blank a page that had good content.
    expect(body.delta.matched).toBe(true);
    expect(body.delta.verdict.code).toBeTruthy();
    expect(body.narration).toBeNull();
    expect(body.stale).toBe(false);
    expect(body.generatable).toBe(true);
    expect(mocks.createLlmClientCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// assemble()'s non-404 failure branch
// ---------------------------------------------------------------------------

describe("assemble() unexpected failure -> 500", () => {
  it("GET: a non-CompletedWorkoutNotFound error from gatherReportContext -> 500", async () => {
    mocks.contextThrows = new Error("completed_workouts read failed: connection reset");
    const res = await invokeGet();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("internal");
    expect(mocks.createLlmClientCalls).toBe(0);
  });

  it("POST: same -> 500, no LLM call, no row written", async () => {
    mocks.contextThrows = new Error("completed_workouts read failed: connection reset");
    const res = await invokePost();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("internal");
    expect(mocks.narrateCalls).toHaveLength(0);
    expect(mocks.upsertCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// verdictChanged — a stored note that explains a verdict category the fresh
// delta no longer produces must be flagged so the UI suppresses it.
// ---------------------------------------------------------------------------

describe("GET — verdictChanged", () => {
  it("stale AND the stored verdict_code differs -> verdictChanged true", async () => {
    mocks.context = matchedContext();
    mocks.storedReportRow = {
      narrative: "You came up well short of the prescription today.",
      takeaway: "Aim for the full duration next time.",
      verdict_code: "under_executed",
      input_fingerprint: "a-stale-fingerprint",
    };

    const res = await invokeGet();
    const body = await res.json();

    expect(body.delta.verdict.code).toBe("executed_as_prescribed");
    expect(body.stale).toBe(true);
    expect(body.verdictChanged).toBe(true);
  });

  it("stale but the verdict category is unchanged -> verdictChanged absent", async () => {
    mocks.context = matchedContext();
    mocks.storedReportRow = {
      narrative: "Right on the money.",
      takeaway: "Keep it up.",
      verdict_code: "executed_as_prescribed",
      input_fingerprint: "a-stale-fingerprint",
    };

    const res = await invokeGet();
    const body = await res.json();
    expect(body.stale).toBe(true);
    expect(body.verdictChanged).toBeUndefined();
  });

  it("fresh fingerprint -> never verdictChanged, whatever the stored code says", async () => {
    mocks.context = matchedContext();
    mocks.storedReportRow = {
      narrative: "Right on the money.",
      takeaway: "Keep it up.",
      verdict_code: "under_executed",
      input_fingerprint: computeFingerprint(mocks.context),
    };

    const res = await invokeGet();
    const body = await res.json();
    expect(body.stale).toBe(false);
    expect(body.verdictChanged).toBeUndefined();
  });

  it("a legacy row with a NULL verdict_code falls back to plain staleness", async () => {
    mocks.context = matchedContext();
    mocks.storedReportRow = {
      narrative: "Old note from before verdict_code was written.",
      takeaway: "Old takeaway.",
      verdict_code: null,
      input_fingerprint: "a-stale-fingerprint",
    };

    const res = await invokeGet();
    const body = await res.json();
    expect(body.stale).toBe(true);
    expect(body.verdictChanged).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST — fingerprint short-circuit (the cache hit)
// ---------------------------------------------------------------------------

describe("POST — fingerprint short-circuit", () => {
  it("stored narrative with a matching fingerprint -> cached row returned, ZERO LLM calls, no write", async () => {
    mocks.context = matchedContext();
    mocks.storedReportRow = {
      narrative: "Already written.",
      takeaway: "Already advised.",
      verdict_code: "executed_as_prescribed",
      input_fingerprint: computeFingerprint(mocks.context),
    };

    const res = await invokePost();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.narration).toEqual({ note: "Already written.", takeaway: "Already advised." });
    expect(body.stale).toBe(false);
    // The whole point: an unbounded POST loop costs nothing after the first.
    expect(mocks.createLlmClientCalls).toBe(0);
    expect(mocks.narrateCalls).toHaveLength(0);
    expect(mocks.upsertCalls).toHaveLength(0);
  });

  it("stored narrative with a STALE fingerprint -> regenerates", async () => {
    mocks.context = matchedContext();
    mocks.storedReportRow = {
      narrative: "Old.",
      takeaway: "Old.",
      verdict_code: "under_executed",
      input_fingerprint: "no-longer-matching",
    };
    mocks.narrateResult = NARRATION;

    const res = await invokePost();
    expect(res.status).toBe(200);
    expect((await res.json()).narration).toEqual(NARRATION);
    expect(mocks.narrateCalls).toHaveLength(1);
    expect(mocks.upsertCalls).toHaveLength(1);
  });

  it("a failed stored-report read does not block generation", async () => {
    mocks.context = matchedContext();
    mocks.storedReportReadError = { message: "connection reset" };
    mocks.narrateResult = NARRATION;

    const res = await invokePost();
    expect(res.status).toBe(200);
    expect(mocks.narrateCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// POST — generation quota
// ---------------------------------------------------------------------------

describe("POST — generation quota", () => {
  it("at the limit -> 429 with Retry-After, no LLM call, no write", async () => {
    const { GENERATION_MAX_PER_WINDOW } = await import("../route");
    mocks.context = matchedContext();
    mocks.quotaCount = GENERATION_MAX_PER_WINDOW;

    const res = await invokePost();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(mocks.createLlmClientCalls).toBe(0);
    expect(mocks.upsertCalls).toHaveLength(0);
  });

  it("under the limit -> generates normally", async () => {
    const { GENERATION_MAX_PER_WINDOW } = await import("../route");
    mocks.context = matchedContext();
    mocks.quotaCount = GENERATION_MAX_PER_WINDOW - 1;
    mocks.narrateResult = NARRATION;

    const res = await invokePost();
    expect(res.status).toBe(200);
    expect(mocks.upsertCalls).toHaveLength(1);
  });

  it("the quota count is scoped to the caller and to the window", async () => {
    mocks.context = matchedContext();
    mocks.narrateResult = NARRATION;
    await invokePost();

    expect(mocks.quotaCountCalls).toHaveLength(1);
    expect(mocks.quotaCountCalls[0].athlete_id).toBe(ATHLETE);
    expect(mocks.quotaCountCalls[0].deleted_at).toBeNull();
    expect(typeof mocks.quotaCountCalls[0]["gte:generated_at"]).toBe("string");
  });

  it("fails OPEN: a broken count query does not block a legitimate generation", async () => {
    mocks.context = matchedContext();
    mocks.quotaCountError = { message: "count failed" };
    mocks.narrateResult = NARRATION;

    const res = await invokePost();
    expect(res.status).toBe(200);
    expect(mocks.upsertCalls).toHaveLength(1);
  });

  // A cache hit must not be charged against the quota — it costs nothing.
  it("a cache hit short-circuits BEFORE the quota check", async () => {
    const { GENERATION_MAX_PER_WINDOW } = await import("../route");
    mocks.context = matchedContext();
    mocks.quotaCount = GENERATION_MAX_PER_WINDOW + 5;
    mocks.storedReportRow = {
      narrative: "Cached.",
      takeaway: "Cached takeaway.",
      verdict_code: "executed_as_prescribed",
      input_fingerprint: computeFingerprint(mocks.context),
    };

    const res = await invokePost();
    expect(res.status).toBe(200);
    expect((await res.json()).narration).toEqual({ note: "Cached.", takeaway: "Cached takeaway." });
  });
});

// ---------------------------------------------------------------------------
// POST — a failed regeneration must NOT wipe the stored narrative
// ---------------------------------------------------------------------------

describe("POST — failed regeneration preserves the stored narrative", () => {
  const STORED = {
    narrative: "The note the athlete is currently reading.",
    takeaway: "The takeaway they are currently reading.",
    verdict_code: "under_executed",
    input_fingerprint: "stale-so-we-attempt-a-regeneration",
  };

  it("retryable LLM failure -> the OLD note comes back, flagged stale + retryable", async () => {
    mocks.context = matchedContext();
    mocks.storedReportRow = { ...STORED };
    mocks.narrateThrows = new LlmRateLimited("rate limited");

    const res = await invokePost();
    expect(res.status).toBe(200);
    const body = await res.json();

    // No row was written, so the stored note is still the truth — returning
    // `narration: null` here would erase it off the athlete's screen.
    expect(body.narration).toEqual({ note: STORED.narrative, takeaway: STORED.takeaway });
    expect(body.stale).toBe(true);
    expect(body.retryable).toBe(true);
    expect(body.delta.matched).toBe(true);
    expect(mocks.upsertCalls).toHaveLength(0);
  });

  it("permanent LLM failure -> same, with retryable false", async () => {
    mocks.context = matchedContext();
    mocks.storedReportRow = { ...STORED };
    mocks.narrateThrows = new LlmInvalidOutput("unparseable");

    const res = await invokePost();
    const body = await res.json();

    expect(body.narration).toEqual({ note: STORED.narrative, takeaway: STORED.takeaway });
    expect(body.retryable).toBe(false);
    expect(mocks.upsertCalls).toHaveLength(0);
  });

  it("a failed FIRST generation (nothing stored) still returns narration null", async () => {
    mocks.context = matchedContext();
    mocks.storedReportRow = null;
    mocks.narrateThrows = new LlmRateLimited("rate limited");

    const res = await invokePost();
    const body = await res.json();
    expect(body.narration).toBeNull();
    expect(body.retryable).toBe(true);
  });

  it("carries verdictChanged through a failure, so the UI still suppresses a contradicting note", async () => {
    mocks.context = matchedContext();
    mocks.storedReportRow = { ...STORED, verdict_code: "under_executed" };
    mocks.narrateThrows = new LlmRateLimited("rate limited");

    const body = await (await invokePost()).json();
    expect(body.delta.verdict.code).toBe("executed_as_prescribed");
    expect(body.verdictChanged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST — the upsert row
// ---------------------------------------------------------------------------

describe("POST — upsert row contents", () => {
  it("clears deleted_at, so a regenerated report is not written into a soft-deleted row", async () => {
    mocks.context = matchedContext();
    mocks.narrateResult = NARRATION;

    await invokePost();
    // The unique index is PLAIN, not partial on deleted_at IS NULL, so the
    // upsert conflicts onto a soft-deleted row. Without resetting the column
    // the fresh narrative lands somewhere every read filters out.
    expect(mocks.upsertCalls[0].row.deleted_at).toBeNull();
  });

  it("stamps the verdict_code the narrative was written against", async () => {
    mocks.context = matchedContext();
    mocks.narrateResult = NARRATION;

    const res = await invokePost();
    const body = await res.json();
    expect(mocks.upsertCalls[0].row.verdict_code).toBe(body.delta.verdict.code);
  });

  it("writes athlete_id from the AUTHENTICATED caller, never from the request", async () => {
    mocks.authUser = { id: OTHER_ATHLETE };
    mocks.context = matchedContext();
    mocks.narrateResult = NARRATION;

    await invokePost();
    expect(mocks.upsertCalls[0].row.athlete_id).toBe(OTHER_ATHLETE);
  });
});
