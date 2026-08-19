// Unit tests for GET/POST /api/reviews/[kind]/[periodKey] (U6).
//
// Mirrors the harness in app/api/workouts/[id]/report/__tests__/route.test.ts:
// module-level vi.mock of the route's I/O dependencies, no real DB, LLM, or
// network anywhere in this file.
//
// THE CLIENT SPLIT THE FAKES ENFORCE: the route uses the @supabase/ssr client
// for AUTH ONLY and the service-role client for ALL DATA. The auth fake's
// `.from()` therefore THROWS -- a regression that reads data under the auth
// client fails loudly here instead of silently returning zero rows only for
// cookie-less (mobile) callers, which is exactly how that bug escaped review
// once already in this repo.
//
// THE LOAD-BEARING ASSERTION (KTD2): every GET test asserts the LLM boundary
// was never touched. The read path must never call it, full stop.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

import type { PeriodNarration } from "@da2/shared";

import { LlmInvalidOutput, LlmRateLimited } from "@/llm";
import { PeriodNarrationInvalidError } from "@/ai/period-reviews/narrate";

const ATHLETE = "00000000-0000-0000-0000-0000000000a1";
const BEARER = "mobile-access-token";
const KIND = "weekly";
const KEY = "2026-W33";

const NARRATION: PeriodNarration = {
  note: "You held five of six sessions together.",
  takeaway: "Keep next week's long ride conversational.",
};

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  getUserTokens: [] as (string | undefined)[],
  entitled: true,
  timezone: "Europe/London",
  // assemblePeriodReview control
  assembleResult: null as Record<string, unknown> | null,
  assembleThrows: null as Error | null,
  assembleCalls: [] as Record<string, unknown>[],
  // period_reviews SELECT
  storedRow: null as Record<string, unknown> | null,
  storedReadError: null as { message: string } | null,
  storedSelectFilters: [] as Record<string, unknown>[],
  // quota COUNT
  quotaCount: 0,
  quotaCountError: null as { message: string } | null,
  // narratePeriod control
  narrateResult: null as PeriodNarration | null,
  narrateThrows: null as Error | null,
  narrateCalls: [] as unknown[],
  createLlmClientCalls: 0,
  // upsert
  upsertCalls: [] as Array<{ row: Record<string, unknown>; opts: Record<string, unknown> }>,
  upsertError: null as { message: string } | null,
  rowsByKey: new Map<string, Record<string, unknown>>(),
  duplicateKeyWrites: 0,
  // "now" the route sees, so period-closed logic is deterministic
  now: new Date("2026-08-20T12:00:00Z"),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FACTS = {
  kind: "weekly" as const,
  periodKey: KEY,
  bounds: { start: "2026-08-10", end: "2026-08-16" },
  totals: {
    sessions: 5,
    durationS: 22800,
    distanceM: 61000,
    load: 340,
    activeDays: 4,
    loadConfidence: "mixed" as const,
  },
  compliance: { prescribed: 6, completed: 5, unplanned: 0 },
  duration: { status: "under" as const, prescribed: 25200, actual: 22800, deltaPct: -9.52 },
  load: { status: "under" as const, prescribed: 380, actual: 340, deltaPct: -10.53 },
  sports: [],
  comparison: { available: false as const },
};

function assembled(fingerprint = "fp-1") {
  return {
    context: { athleteId: ATHLETE, timezone: mocks.timezone },
    facts: FACTS,
    fingerprint,
    factSheet: { kind: "weekly", periodKey: KEY },
  };
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

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
        `route read table "${table}" under the AUTH client -- data must go through the ` +
          "service-role client, or cookie-less Bearer (mobile) callers query as anon and get zero rows",
      );
    },
  };
}

class QueryFake {
  readonly filters: Record<string, unknown> = {};

  constructor(
    private readonly resolve: (f: Record<string, unknown>) => {
      data?: unknown;
      error: unknown;
      count?: number;
    },
  ) {}

  select() {
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
  or() {
    return this;
  }
  limit() {
    return this;
  }
  async maybeSingle() {
    return this.resolve(this.filters);
  }
  then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
    return Promise.resolve(this.resolve(this.filters)).then(onFulfilled, onRejected);
  }
}

function makeAdminFake() {
  return {
    from(table: string) {
      if (table === "entitlements") {
        return {
          select: () =>
            new QueryFake(() => ({ data: mocks.entitled ? { user_id: ATHLETE } : null, error: null })),
        };
      }
      if (table === "users") {
        return {
          select: () =>
            new QueryFake((f) => ({
              data: f.id === ATHLETE ? { timezone: mocks.timezone } : null,
              error: null,
            })),
        };
      }
      if (table !== "period_reviews") {
        throw new Error(`unexpected table on admin client: ${table}`);
      }
      return {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.head) {
            return new QueryFake(() => ({
              error: mocks.quotaCountError,
              count: mocks.quotaCount,
            }));
          }
          return new QueryFake((filters) => {
            mocks.storedSelectFilters.push(filters);
            // Athlete scoping is ENFORCED by the fake, not merely asserted: a
            // query for the wrong athlete reads as "no row", exactly as
            // Postgres would with the explicit filter in place.
            if (filters.athlete_id !== undefined && filters.athlete_id !== ATHLETE) {
              return { data: null, error: null };
            }
            return { data: mocks.storedRow, error: mocks.storedReadError };
          });
        },
        // `.upsert()` is UNIMPLEMENTED on purpose. The identity index is
        // PARTIAL, so a real .upsert({onConflict}) raises 42P10 at runtime —
        // and a fake that accepted it is precisely what let that bug reach
        // review. Calling it now fails loudly instead of blessing it.
        upsert() {
          throw new Error(
            "period_reviews.upsert() is invalid: the identity index is PARTIAL and " +
              "Postgres raises 42P10. Use persistPeriodReview (INSERT/23505/UPDATE).",
          );
        },
        insert(row: Record<string, unknown>) {
          mocks.upsertCalls.push({ row, opts: {} });
          if (mocks.upsertError) return Promise.resolve({ error: mocks.upsertError });

          const key = `${row.athlete_id}:${row.kind}:${row.period_key}`;
          // Model the partial unique index: a live row for this identity makes
          // the INSERT fail with 23505, which is what drives the UPDATE branch.
          if (mocks.rowsByKey.has(key)) {
            return Promise.resolve({
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            });
          }
          mocks.rowsByKey.set(key, row);
          return Promise.resolve({ error: null });
        },
        update(patch: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return builder;
            },
            is() {
              return builder;
            },
            select() {
              return builder;
            },
            maybeSingle() {
              const key = `${filters.athlete_id}:${filters.kind}:${filters.period_key}`;
              const existing = mocks.rowsByKey.get(key);
              if (!existing) return Promise.resolve({ data: null, error: null });
              mocks.rowsByKey.set(key, { ...existing, ...patch });
              mocks.upsertCalls.push({ row: patch, opts: { update: true } });
              return Promise.resolve({ data: { id: "r-1" }, error: null });
            },
          };
          return builder;
        },
      };
    },
  };
}

vi.mock("@/auth/server", () => ({ createClient: async () => makeAuthClientFake() }));
vi.mock("@/db/admin", () => ({ createAdminClient: () => makeAdminFake() }));

vi.mock("@/ai/period-reviews/assemble", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ai/period-reviews/assemble")>();
  return {
    ...actual,
    assemblePeriodReview: vi.fn(async (args: Record<string, unknown>) => {
      mocks.assembleCalls.push(args);
      if (mocks.assembleThrows) throw mocks.assembleThrows;
      return mocks.assembleResult ?? assembled();
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

vi.mock("@/ai/period-reviews/narrate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ai/period-reviews/narrate")>();
  return {
    ...actual,
    narratePeriod: vi.fn(async (...args: unknown[]) => {
      mocks.narrateCalls.push(args);
      if (mocks.narrateThrows) throw mocks.narrateThrows;
      if (mocks.narrateResult) return mocks.narrateResult;
      throw new Error("narratePeriod() called without a stubbed result in this test");
    }),
  };
});

// ---------------------------------------------------------------------------
// Invocation helpers
// ---------------------------------------------------------------------------

async function invokeGet(
  kind = KIND,
  key = KEY,
  opts: { bearer?: string } = {},
): Promise<Response> {
  const { GET } = await import("../route");
  const headers = opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : undefined;
  return GET(new Request(`http://localhost:3000/api/reviews/${kind}/${key}`, { headers }), {
    params: Promise.resolve({ kind, periodKey: key }),
  });
}

async function invokePost(
  kind = KIND,
  key = KEY,
  opts: { bearer?: string } = {},
): Promise<Response> {
  const { POST } = await import("../route");
  const headers = opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : undefined;
  return POST(
    new Request(`http://localhost:3000/api/reviews/${kind}/${key}`, { method: "POST", headers }),
    { params: Promise.resolve({ kind, periodKey: key }) },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(mocks.now);

  mocks.authUser = { id: ATHLETE };
  mocks.getUserTokens = [];
  mocks.entitled = true;
  mocks.timezone = "Europe/London";
  mocks.assembleResult = null;
  mocks.assembleThrows = null;
  mocks.assembleCalls = [];
  mocks.storedRow = null;
  mocks.storedReadError = null;
  mocks.storedSelectFilters = [];
  mocks.quotaCount = 0;
  mocks.quotaCountError = null;
  mocks.narrateResult = NARRATION;
  mocks.narrateThrows = null;
  mocks.narrateCalls = [];
  mocks.createLlmClientCalls = 0;
  mocks.upsertCalls = [];
  mocks.upsertError = null;
  mocks.rowsByKey = new Map();
  mocks.duplicateKeyWrites = 0;
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe("GET", () => {
  it("returns facts with no narration when nothing is stored", async () => {
    const res = await invokeGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.facts.periodKey).toBe(KEY);
    expect(body.narration).toBeNull();
    expect(body.generatable).toBe(true);
  });

  // KTD2 — the load-bearing assertion.
  it("never calls the LLM", async () => {
    mocks.storedRow = {
      narrative: NARRATION.note,
      takeaway: NARRATION.takeaway,
      input_fingerprint: "fp-1",
      generated_at: "2026-08-17T18:00:00.000Z",
    };
    await invokeGet();
    expect(mocks.createLlmClientCalls).toBe(0);
    expect(mocks.narrateCalls).toEqual([]);
  });

  it("serves a stored narrative whose fingerprint still matches as fresh", async () => {
    mocks.storedRow = {
      narrative: NARRATION.note,
      takeaway: NARRATION.takeaway,
      input_fingerprint: "fp-1",
      generated_at: "2026-08-17T18:00:00.000Z",
    };
    const body = await (await invokeGet()).json();
    expect(body.narration.note).toBe(NARRATION.note);
    expect(body.stale).toBe(false);
    expect(body.generatedAt).toBe("2026-08-17T18:00:00.000Z");
  });

  // AE3 — enrichment landed after the review was written.
  it("marks a stored narrative stale when the fingerprint has moved", async () => {
    mocks.storedRow = {
      narrative: NARRATION.note,
      takeaway: NARRATION.takeaway,
      input_fingerprint: "fp-OLD",
      generated_at: "2026-08-17T18:00:00.000Z",
    };
    const body = await (await invokeGet()).json();
    expect(body.stale).toBe(true);
    // The prose is still served -- a stale note is better than a blank panel.
    expect(body.narration.note).toBe(NARRATION.note);
  });

  it("ignores a stored row that carries a fingerprint but no prose", async () => {
    mocks.storedRow = {
      narrative: null,
      takeaway: null,
      input_fingerprint: "fp-1",
      generated_at: "2026-08-17T18:00:00.000Z",
    };
    const body = await (await invokeGet()).json();
    expect(body.narration).toBeNull();
  });

  // The facts are the half of the response that always works.
  it("still returns facts when the narrative lookup fails", async () => {
    mocks.storedReadError = { message: "boom" };
    const res = await invokeGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.facts.totals.sessions).toBe(5);
    expect(body.narration).toBeNull();
  });

  it("returns 500 when the facts themselves cannot be assembled", async () => {
    mocks.assembleThrows = new Error("db down");
    expect((await invokeGet()).status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Auth, entitlement, and path validation
// ---------------------------------------------------------------------------

describe("auth and entitlement", () => {
  it.each([
    ["GET", invokeGet],
    ["POST", invokePost],
  ])("rejects an unauthenticated %s", async (_verb, invoke) => {
    mocks.authUser = null;
    expect((await invoke()).status).toBe(401);
  });

  // AE7 — 402, not 404: the athlete needs to know an upgrade unlocks this.
  it.each([
    ["GET", invokeGet],
    ["POST", invokePost],
  ])("refuses an unentitled %s with 402", async (_verb, invoke) => {
    mocks.entitled = false;
    const res = await invoke();
    expect(res.status).toBe(402);
    expect((await res.json()).entitlement_key).toBe("trend_reports");
  });

  it("does no work at all for an unentitled caller", async () => {
    mocks.entitled = false;
    await invokePost();
    expect(mocks.assembleCalls).toEqual([]);
    expect(mocks.createLlmClientCalls).toBe(0);
  });

  // The mobile path the auth-client fake exists to protect.
  it("serves a Bearer-authenticated caller with no cookies", async () => {
    const res = await invokeGet(KIND, KEY, { bearer: BEARER });
    expect(res.status).toBe(200);
    expect(mocks.getUserTokens).toContain(BEARER);
  });

  it("scopes every stored-review read to the authenticated athlete", async () => {
    await invokeGet();
    expect(mocks.storedSelectFilters.length).toBeGreaterThan(0);
    for (const f of mocks.storedSelectFilters) {
      expect(f.athlete_id).toBe(ATHLETE);
    }
  });
});

describe("path validation", () => {
  it.each([
    ["a malformed key", "weekly", "last-week"],
    ["a month key under weekly", "weekly", "2026-08"],
    ["a week key under monthly", "monthly", "2026-W33"],
    ["an unknown kind", "quarterly", "2026-W33"],
    ["week 54", "weekly", "2026-W54"],
  ])("rejects %s with 400", async (_label, kind, key) => {
    const res = await invokeGet(kind, key);
    expect(res.status).toBe(400);
  });

  it("rejects a bad path before touching the database", async () => {
    await invokeGet("weekly", "nonsense");
    expect(mocks.assembleCalls).toEqual([]);
  });

  // A period that has not closed has no review: its numbers would change under
  // the athlete and any narration would describe an incomplete week.
  it("rejects a period that has not closed yet", async () => {
    vi.setSystemTime(new Date("2026-08-12T12:00:00Z")); // mid-W33
    const res = await invokeGet();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("period_not_closed");
  });

  it("accepts the period the instant it closes", async () => {
    // Local Monday 00:00 London = 23:00Z Sunday.
    vi.setSystemTime(new Date("2026-08-16T23:00:00Z"));
    expect((await invokeGet()).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

describe("POST", () => {
  it("generates, persists, and returns the narration", async () => {
    const res = await invokePost();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.narration).toEqual(NARRATION);
    expect(body.stale).toBe(false);
    expect(mocks.upsertCalls).toHaveLength(1);
    expect(mocks.upsertCalls[0].row).toMatchObject({
      athlete_id: ATHLETE,
      kind: KIND,
      period_key: KEY,
      period_start: "2026-08-10",
      period_end: "2026-08-16",
      narrative: NARRATION.note,
      input_fingerprint: "fp-1",
    });
    // No explicit deleted_at: a fresh INSERT gets the column default. The
    // resurrect-a-tombstone case the old upsert had to guard against cannot
    // arise, because a soft-deleted row never conflicts with a partial index.
  });

  // AE4 — the cache short-circuit is what makes the quota sufficient rather
  // than decorative.
  it("does not call the LLM when the stored fingerprint still matches", async () => {
    mocks.storedRow = {
      narrative: NARRATION.note,
      takeaway: NARRATION.takeaway,
      input_fingerprint: "fp-1",
      generated_at: "2026-08-17T18:00:00.000Z",
    };
    const res = await invokePost();
    expect(res.status).toBe(200);
    expect(mocks.createLlmClientCalls).toBe(0);
    expect(mocks.upsertCalls).toEqual([]);
  });

  it("regenerates when the stored fingerprint has moved", async () => {
    mocks.storedRow = {
      narrative: "old prose",
      takeaway: "old takeaway",
      input_fingerprint: "fp-OLD",
      generated_at: "2026-08-17T18:00:00.000Z",
    };
    await invokePost();
    expect(mocks.narrateCalls).toHaveLength(1);
    expect(mocks.upsertCalls).toHaveLength(1);
  });

  // The regeneration path. Against a PARTIAL unique index this is where
  // .upsert({onConflict}) raised 42P10; persistPeriodReview falls through to an
  // UPDATE so exactly one live row survives.
  it("updates in place on a second generation rather than duplicating", async () => {
    await invokePost();
    mocks.storedRow = null; // force a cache miss so the second POST regenerates
    await invokePost();
    expect(mocks.duplicateKeyWrites).toBe(0);
    expect(mocks.rowsByKey.size).toBe(1);
  });

  it("returns 500 and no row when the upsert fails", async () => {
    mocks.upsertError = { message: "write failed" };
    expect((await invokePost()).status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Degraded generation (AE9)
// ---------------------------------------------------------------------------

describe("degraded generation", () => {
  it("returns facts with retryable=true on a rate limit, not a 5xx", async () => {
    mocks.narrateThrows = new LlmRateLimited("429");
    const res = await invokePost();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.facts.totals.sessions).toBe(5);
    expect(body.retryable).toBe(true);
    expect(mocks.upsertCalls).toEqual([]);
  });

  it("returns retryable=false when the model produced unusable output", async () => {
    mocks.narrateThrows = new PeriodNarrationInvalidError("schema mismatch");
    const body = await (await invokePost()).json();
    expect(body.retryable).toBe(false);
    expect(mocks.upsertCalls).toEqual([]);
  });

  it("treats unparseable model output the same way", async () => {
    mocks.narrateThrows = new LlmInvalidOutput("no json");
    const body = await (await invokePost()).json();
    expect(body.retryable).toBe(false);
  });

  // A failed REgeneration must not wipe prose the athlete is currently reading.
  it("keeps the previously stored narrative when regeneration fails", async () => {
    mocks.storedRow = {
      narrative: "prose the athlete is reading right now",
      takeaway: "old takeaway",
      input_fingerprint: "fp-OLD",
      generated_at: "2026-08-17T18:00:00.000Z",
    };
    mocks.narrateThrows = new LlmRateLimited("429");
    const body = await (await invokePost()).json();
    expect(body.narration.note).toBe("prose the athlete is reading right now");
    expect(body.stale).toBe(true);
    expect(body.retryable).toBe(true);
  });

  it("returns 500 for a genuinely unexpected failure", async () => {
    mocks.narrateThrows = new Error("createLlmClient misconfigured");
    expect((await invokePost()).status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Generation quota
// ---------------------------------------------------------------------------

describe("generation quota", () => {
  it("returns 429 with Retry-After once the window is full", async () => {
    mocks.quotaCount = 10;
    const res = await invokePost();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(mocks.createLlmClientCalls).toBe(0);
  });

  // The quota protects a shared budget; it is not an authorization check, so a
  // hiccuping COUNT must not block a paying athlete's review.
  it("fails open when the quota count errors", async () => {
    mocks.quotaCountError = { message: "count boom" };
    expect((await invokePost()).status).toBe(200);
  });

  // A cached hit is free and must not be refused on quota grounds.
  it("serves a cache hit even when the quota is exhausted", async () => {
    mocks.quotaCount = 10;
    mocks.storedRow = {
      narrative: NARRATION.note,
      takeaway: NARRATION.takeaway,
      input_fingerprint: "fp-1",
      generated_at: "2026-08-17T18:00:00.000Z",
    };
    expect((await invokePost()).status).toBe(200);
  });
});
