// Unit tests for GET /api/reviews — the completed-periods listing (U6).
//
// The behaviour worth pinning here is that the list is ENUMERATED from the
// calendar, not read from period_reviews. A period the athlete trained in but
// never opened still belongs in the list; reading the table would show only the
// periods they had already generated, which is the opposite of a list's job.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

const ATHLETE = "00000000-0000-0000-0000-0000000000a1";

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  entitled: true,
  timezone: "Europe/London",
  narratedRows: [] as Array<{ kind: string; period_key: string }>,
  narratedReadError: null as { message: string } | null,
  assembleCalls: [] as Record<string, unknown>[],
  /** Period keys that should blow up when assembled, to prove one bad period
   * does not take the whole list down. */
  failingKeys: new Set<string>(),
  now: new Date("2026-08-20T12:00:00Z"),
}));

function makeAuthClientFake() {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: mocks.authUser }, error: null }),
    },
    from(table: string) {
      throw new Error(`route read table "${table}" under the AUTH client`);
    },
  };
}

class QueryFake {
  readonly filters: Record<string, unknown> = {};
  constructor(private readonly resolve: () => { data?: unknown; error: unknown }) {}
  select() {
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters[col] = v;
    return this;
  }
  is() {
    return this;
  }
  not() {
    return this;
  }
  or() {
    return this;
  }
  limit() {
    return this;
  }
  async maybeSingle() {
    return this.resolve();
  }
  then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
    return Promise.resolve(this.resolve()).then(onFulfilled, onRejected);
  }
}

function makeAdminFake() {
  return {
    from(table: string) {
      if (table === "entitlements") {
        return {
          select: () =>
            new QueryFake(() => ({
              data: mocks.entitled ? { user_id: ATHLETE } : null,
              error: null,
            })),
        };
      }
      if (table === "users") {
        return { select: () => new QueryFake(() => ({ data: { timezone: mocks.timezone }, error: null })) };
      }
      if (table === "period_reviews") {
        return {
          select: () =>
            new QueryFake(() => ({
              data: mocks.narratedRows,
              error: mocks.narratedReadError,
            })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
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
      const key = args.periodKey as string;
      if (mocks.failingKeys.has(key)) throw new Error(`assemble failed for ${key}`);
      return {
        context: {},
        fingerprint: "fp",
        factSheet: {},
        facts: {
          kind: args.kind,
          periodKey: key,
          // Constant bounds are fine: the route sorts on the REAL calendar's
          // bounds for the key, not on whatever the facts carry.
          bounds: { start: "2026-01-01", end: "2026-01-07" },
          totals: {
            sessions: 3,
            durationS: 7200,
            distanceM: 20000,
            load: 150,
            activeDays: 3,
            loadConfidence: "power",
          },
          compliance: { prescribed: 3, completed: 3, unplanned: 0 },
          duration: { status: "on_target", prescribed: 7200, actual: 7200, deltaPct: 0 },
          load: { status: "on_target", prescribed: 150, actual: 150, deltaPct: 0 },
          sports: [],
          comparison: { available: false },
        },
      };
    }),
  };
});

async function invoke(query = ""): Promise<Response> {
  const { GET } = await import("../route");
  return GET(new Request(`http://localhost:3000/api/reviews${query}`));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(mocks.now);
  mocks.authUser = { id: ATHLETE };
  mocks.entitled = true;
  mocks.timezone = "Europe/London";
  mocks.narratedRows = [];
  mocks.narratedReadError = null;
  mocks.assembleCalls = [];
  mocks.failingKeys = new Set();
});

describe("GET /api/reviews", () => {
  it("returns both cadences by default", async () => {
    const body = await (await invoke()).json();
    const kinds = new Set(body.periods.map((p: { kind: string }) => p.kind));
    expect(kinds).toEqual(new Set(["weekly", "monthly"]));
  });

  it("narrows to one cadence when asked", async () => {
    const body = await (await invoke("?kind=weekly")).json();
    expect(body.periods.every((p: { kind: string }) => p.kind === "weekly")).toBe(true);
  });

  it("rejects an unknown kind", async () => {
    expect((await invoke("?kind=quarterly")).status).toBe(400);
  });

  // The in-flight period must never appear: its numbers change under the
  // athlete and there is nothing final to review.
  it("lists only completed periods", async () => {
    const body = await (await invoke("?kind=weekly")).json();
    const keys = body.periods.map((p: { periodKey: string }) => p.periodKey);
    // 2026-08-20 is inside 2026-W34, so W34 is still running.
    expect(keys).not.toContain("2026-W34");
    expect(keys[0]).toBe("2026-W33");
  });

  it("orders newest first", async () => {
    const body = await (await invoke("?kind=weekly")).json();
    const keys = body.periods.map((p: { periodKey: string }) => p.periodKey);
    expect(keys).toEqual([...keys].sort().reverse());
  });

  // A period with facts but no stored prose still belongs in the list.
  it("marks which periods already have narration", async () => {
    mocks.narratedRows = [{ kind: "weekly", period_key: "2026-W33" }];
    const body = await (await invoke("?kind=weekly")).json();
    const w33 = body.periods.find((p: { periodKey: string }) => p.periodKey === "2026-W33");
    const w32 = body.periods.find((p: { periodKey: string }) => p.periodKey === "2026-W32");
    expect(w33.hasNarration).toBe(true);
    expect(w32.hasNarration).toBe(false);
  });

  // Degrading to "none narrated" costs a generate affordance where a
  // regenerate one belonged — far better than an error page.
  it("still lists periods when the narrated-keys read fails", async () => {
    mocks.narratedReadError = { message: "boom" };
    const res = await invoke("?kind=weekly");
    expect(res.status).toBe(200);
    expect((await res.json()).periods.length).toBeGreaterThan(0);
  });

  it("drops a period that fails to assemble rather than failing the list", async () => {
    mocks.failingKeys = new Set(["2026-W33"]);
    const body = await (await invoke("?kind=weekly")).json();
    const keys = body.periods.map((p: { periodKey: string }) => p.periodKey);
    expect(keys).not.toContain("2026-W33");
    expect(keys.length).toBeGreaterThan(0);
  });

  it("carries a headline stat per period", async () => {
    const body = await (await invoke("?kind=weekly")).json();
    expect(body.periods[0]).toMatchObject({ sessions: 3, durationS: 7200, load: 150 });
  });

  it("rejects an unauthenticated caller", async () => {
    mocks.authUser = null;
    expect((await invoke()).status).toBe(401);
  });

  it("refuses an unentitled caller with 402 and does no work", async () => {
    mocks.entitled = false;
    expect((await invoke()).status).toBe(402);
    expect(mocks.assembleCalls).toEqual([]);
  });

  it("scopes every assembly to the authenticated athlete", async () => {
    await invoke();
    expect(mocks.assembleCalls.length).toBeGreaterThan(0);
    for (const call of mocks.assembleCalls) {
      expect(call.athleteId).toBe(ATHLETE);
    }
  });

  it("resolves periods in the athlete's timezone", async () => {
    mocks.timezone = "Pacific/Auckland";
    await invoke("?kind=weekly");
    expect(mocks.assembleCalls[0].timezone).toBe("Pacific/Auckland");
  });
});
