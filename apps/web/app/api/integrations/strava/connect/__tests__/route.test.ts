// Unit tests for POST /api/integrations/strava/connect.
//
// The route depends on:
// - @/auth/server.createClient (JWT SSR client) + resolveAuth (Bearer header)
// - @/db/admin.createAdminClient (service-role) for strava_tokens writes
// - inngest.send (event queue dispatch)
// - exchangeAuthorizationCode -> Strava /oauth/token (msw'd)
// - verifyState() against the server-signed nonce minted in test setup
//
// The first three are mocked via vi.mock; the fourth is intercepted with
// msw; the fifth uses the real signing module (with a test signing key).

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.hoisted(() => {
  process.env.STRAVA_TOKEN_KEYS =
    "1:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  process.env.STRAVA_OAUTH_STATE_SIGNING_KEY =
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  process.env.STRAVA_CLIENT_ID = "test-client-id";
  process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

import { setupServer } from "msw/node";

import {
  createMockState,
  stravaApiHandlers,
  type StravaMockState,
} from "@/strava/__tests__/msw-handlers";
import { signState } from "@/strava/state-nonce";

const mocks = vi.hoisted(() => {
  return {
    authUser: null as { id: string; email?: string } | null,
    lastBearerToken: undefined as string | undefined,
    adminFake: null as null | {
      tokensByUser: Map<string, RowState>;
      ownerLookup: Map<number, string>;
      lastUpsert?: RowState;
      // If set, the next upsert call returns this PostgREST-style error
      // instead of writing.
      nextUpsertError?: { code: string; message: string; details?: string } | null;
    },
    inngestSend: vi.fn(),
  };
});

interface RowState {
  user_id: string;
  // Wire format: PostgREST BYTEA hex literal (`\x...`). Our adminFake
  // captures whatever value the route passes, which lets us assert the
  // route is sending strings (not Uint8Arrays) -- the BYTEA serialisation
  // bug fix.
  access_token_enc: string;
  refresh_token_enc: string;
  expires_at: string;
  scope: string;
  athlete_strava_id: number;
  key_version: number;
}

vi.mock("@/auth/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: (token?: string) => {
        mocks.lastBearerToken = token;
        return Promise.resolve({
          data: { user: mocks.authUser },
          error: null,
        });
      },
    },
  }),
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => makeAdminFake(),
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: mocks.inngestSend,
  },
}));

function makeAdminFake() {
  return {
    from(table: string) {
      if (table !== "strava_tokens") {
        throw new Error(`unexpected table: ${table}`);
      }
      return new TokensTable();
    },
  };
}

class TokensTable {
  select(_cols: string) {
    return new SelectBuilder();
  }
  upsert(row: RowState, _opts: { onConflict: string }) {
    if (!mocks.adminFake) {
      throw new Error("adminFake not initialised");
    }
    return new UpsertBuilder(row);
  }
}

class SelectBuilder {
  private filter: { col: string; value: unknown } | null = null;
  eq(col: string, value: unknown) {
    this.filter = { col, value };
    return this;
  }
  async maybeSingle() {
    if (!mocks.adminFake) return { data: null, error: null };
    if (this.filter?.col === "athlete_strava_id") {
      const ownerId = mocks.adminFake.ownerLookup.get(
        this.filter.value as number
      );
      if (ownerId == null) return { data: null, error: null };
      return { data: { user_id: ownerId }, error: null };
    }
    return { data: null, error: null };
  }
}

class UpsertBuilder {
  constructor(private readonly row: RowState) {}
  select(_cols: string) {
    return new UpsertSelectBuilder(this.row);
  }
}

class UpsertSelectBuilder {
  constructor(private readonly row: RowState) {}
  async single() {
    if (!mocks.adminFake) {
      throw new Error("adminFake not initialised");
    }
    if (mocks.adminFake.nextUpsertError) {
      const error = mocks.adminFake.nextUpsertError;
      mocks.adminFake.nextUpsertError = null;
      return { data: null, error };
    }
    mocks.adminFake.tokensByUser.set(this.row.user_id, this.row);
    mocks.adminFake.ownerLookup.set(this.row.athlete_strava_id, this.row.user_id);
    mocks.adminFake.lastUpsert = this.row;
    return {
      data: { athlete_strava_id: this.row.athlete_strava_id },
      error: null,
    };
  }
}

let mockState: StravaMockState;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  mockState = createMockState();
  server.use(...stravaApiHandlers(mockState));
  mocks.authUser = null;
  mocks.lastBearerToken = undefined;
  mocks.adminFake = {
    tokensByUser: new Map(),
    ownerLookup: new Map(),
    nextUpsertError: null,
  };
  mocks.inngestSend.mockReset();
  mocks.inngestSend.mockResolvedValue({ ids: ["evt_1"] });
});

afterEach(() => server.resetHandlers());

async function invokeRoute(
  body: unknown,
  opts: { headers?: Record<string, string> } = {}
): Promise<Response> {
  // Dynamic import so vi.mock above takes effect before module evaluation.
  const { POST } = await import("../route");
  return await POST(
    new Request("http://localhost:3000/api/integrations/strava/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
      body: JSON.stringify(body),
    })
  );
}

function buildValidBody(userId: string): {
  code: string;
  code_verifier: string;
  redirect_uri: string;
  state: string;
} {
  return {
    code: "auth-code-1",
    code_verifier: "verifier-1",
    redirect_uri: "https://example.com/cb",
    state: signState(userId, 600),
  };
}

describe("POST /api/integrations/strava/connect", () => {
  it("returns 401 when there is no authenticated user", async () => {
    const res = await invokeRoute(buildValidBody("user-a"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 400 state_mismatch when the state HMAC does not verify", async () => {
    mocks.authUser = { id: "user-a" };
    // A state minted for user-b cannot pass user-a's verifier.
    const otherUsersState = signState("user-b", 600);
    const res = await invokeRoute({
      code: "x",
      code_verifier: "v",
      redirect_uri: "https://example.com/cb",
      state: otherUsersState,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("state_mismatch");
    expect(mockState.authorizeCalls).toHaveLength(0);
  });

  it("returns 400 state_mismatch for an obviously-forged state (attacker writes 'x.x.x')", async () => {
    mocks.authUser = { id: "user-a" };
    const res = await invokeRoute({
      code: "x",
      code_verifier: "v",
      redirect_uri: "https://example.com/cb",
      state: "x.x.x",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("state_mismatch");
  });

  it("returns 400 invalid_input on a Zod-rejected body (missing code_verifier)", async () => {
    mocks.authUser = { id: "user-a" };
    const res = await invokeRoute({
      code: "x",
      redirect_uri: "https://example.com/cb",
      state: signState("user-a", 600),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("forwards a Bearer token to supabase.auth.getUser", async () => {
    mocks.authUser = { id: "user-bearer" };
    mockState.authorize.push({
      kind: "ok",
      payload: {
        access_token: "a",
        refresh_token: "r",
        expires_at: Math.floor(Date.UTC(2026, 4, 14, 18, 0, 0) / 1000),
        scope: "activity:read",
        athlete: { id: 1234 },
      },
    });
    const res = await invokeRoute(buildValidBody("user-bearer"), {
      headers: { Authorization: "Bearer test-jwt" },
    });
    expect(res.status).toBe(202);
    expect(mocks.lastBearerToken).toBe("test-jwt");
  });

  it("on happy path: persists encrypted tokens (BYTEA hex string), enqueues backfill, returns 202", async () => {
    mocks.authUser = { id: "user-happy" };
    mockState.authorize.push({
      kind: "ok",
      payload: {
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_at: Math.floor(Date.UTC(2026, 4, 14, 18, 0, 0) / 1000),
        scope: "activity:read,activity:read_all,profile:read_all",
        athlete: { id: 5005 },
      },
    });

    const res = await invokeRoute(buildValidBody("user-happy"));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ status: "connected", athlete_strava_id: 5005 });

    expect(mockState.authorizeCalls).toHaveLength(1);
    expect(mockState.authorizeCalls[0]).toMatchObject({
      code: "auth-code-1",
      code_verifier: "verifier-1",
      redirect_uri: "https://example.com/cb",
    });

    // Token row exists, encrypted, attached to this user.
    const persisted = mocks.adminFake!.tokensByUser.get("user-happy")!;
    expect(persisted).toBeDefined();
    expect(persisted.athlete_strava_id).toBe(5005);
    expect(persisted.scope).toBe(
      "activity:read,activity:read_all,profile:read_all"
    );
    expect(persisted.expires_at).toBe("2026-05-14T18:00:00.000Z");
    // CRITICAL: BYTEA serialisation. The supabase-js call must receive a
    // `\x<hex>` STRING, NOT a Uint8Array. JSON.stringify(Uint8Array) =
    // {"0":..,"1":..,...} which PostgREST rejects with 422.
    expect(typeof persisted.access_token_enc).toBe("string");
    expect(persisted.access_token_enc.startsWith("\\x")).toBe(true);
    expect(typeof persisted.refresh_token_enc).toBe("string");
    expect(persisted.refresh_token_enc.startsWith("\\x")).toBe(true);
    // Sanity: the plaintext is not present in the hex (encryption did
    // happen).
    expect(persisted.access_token_enc).not.toContain(
      Buffer.from("access-1").toString("hex")
    );

    // Backfill event enqueued.
    expect(mocks.inngestSend).toHaveBeenCalledWith({
      name: "strava/backfill.start",
      data: { user_id: "user-happy" },
    });
  });

  it("happy path: same-user reconnect (owner exists with same user_id) -> upsert succeeds (T-03)", async () => {
    mocks.adminFake!.ownerLookup.set(5005, "user-same");
    mocks.authUser = { id: "user-same" };
    mockState.authorize.push({
      kind: "ok",
      payload: {
        access_token: "a",
        refresh_token: "r",
        expires_at: Math.floor(Date.UTC(2026, 4, 14, 18, 0, 0) / 1000),
        scope: "activity:read",
        athlete: { id: 5005 },
      },
    });

    const res = await invokeRoute(buildValidBody("user-same"));
    expect(res.status).toBe(202);
    expect(mocks.adminFake!.tokensByUser.get("user-same")).toBeDefined();
  });

  it("returns 409 strava_account_already_linked when athlete_strava_id maps to a different user", async () => {
    mocks.adminFake!.ownerLookup.set(7777, "user-original-owner");

    mocks.authUser = { id: "user-collider" };
    mockState.authorize.push({
      kind: "ok",
      payload: {
        access_token: "a",
        refresh_token: "r",
        expires_at: Math.floor(Date.UTC(2026, 4, 14, 18, 0, 0) / 1000),
        scope: "activity:read",
        athlete: { id: 7777 },
      },
    });

    const res = await invokeRoute(buildValidBody("user-collider"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("strava_account_already_linked");

    // Critically: the original owner's row is NOT overwritten.
    expect(mocks.adminFake!.tokensByUser.get("user-collider")).toBeUndefined();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("returns 409 strava_account_already_linked when the upsert hits Postgres 23505 unique_violation (race)", async () => {
    // Pre-check passes (no owner), but a concurrent writer beat us to
    // the unique index. PostgREST surfaces this as code 23505 with
    // details mentioning athlete_strava_id.
    mocks.authUser = { id: "user-race-loser" };
    mocks.adminFake!.nextUpsertError = {
      code: "23505",
      message: "duplicate key value violates unique constraint",
      details: "Key (athlete_strava_id)=(8888) already exists.",
    };
    mockState.authorize.push({
      kind: "ok",
      payload: {
        access_token: "a",
        refresh_token: "r",
        expires_at: Math.floor(Date.UTC(2026, 4, 14, 18, 0, 0) / 1000),
        scope: "activity:read",
        athlete: { id: 8888 },
      },
    });

    const res = await invokeRoute(buildValidBody("user-race-loser"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("strava_account_already_linked");
    expect(mocks.adminFake!.tokensByUser.get("user-race-loser")).toBeUndefined();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("returns 400 strava_rejected_code when Strava 400s on the exchange", async () => {
    mocks.authUser = { id: "user-bad-code" };
    mockState.authorize.push({ kind: "invalid-code" });

    const res = await invokeRoute(buildValidBody("user-bad-code"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("strava_rejected_code");
    // Token write was not attempted.
    expect(mocks.adminFake!.tokensByUser.size).toBe(0);
  });

  it("still returns 202 if Inngest enqueue fails after a successful token write", async () => {
    mocks.authUser = { id: "user-inngest-down" };
    mockState.authorize.push({
      kind: "ok",
      payload: {
        access_token: "a",
        refresh_token: "r",
        expires_at: Math.floor(Date.UTC(2026, 4, 14, 18, 0, 0) / 1000),
        scope: "activity:read",
        athlete: { id: 6006 },
      },
    });
    mocks.inngestSend.mockRejectedValueOnce(new Error("Inngest unreachable"));

    const res = await invokeRoute(buildValidBody("user-inngest-down"));
    expect(res.status).toBe(202);
    // Token row still persisted -- soft failure on the enqueue.
    expect(mocks.adminFake!.tokensByUser.get("user-inngest-down")).toBeDefined();
  });

  it("returns 502 strava_unreachable when Strava /oauth/token throws a network error", async () => {
    mocks.authUser = { id: "user-net" };
    server.resetHandlers();
    server.use();

    const res = await invokeRoute(buildValidBody("user-net"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("strava_unreachable");
  });

  it("logging audit: secrets and the signed state never appear in console.info output (T-05)", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.authUser = { id: "user-log" };
      mockState.authorize.push({
        kind: "ok",
        payload: {
          access_token: "secret-access-token-xyz",
          refresh_token: "secret-refresh-token-xyz",
          expires_at: Math.floor(Date.UTC(2026, 4, 14, 18, 0, 0) / 1000),
          scope: "activity:read",
          athlete: { id: 1212 },
        },
      });
      const body = buildValidBody("user-log");
      const res = await invokeRoute(body);
      expect(res.status).toBe(202);

      const allCalls = [...infoSpy.mock.calls, ...errSpy.mock.calls];
      const forbiddenSubstrings = [
        body.code, // "auth-code-1"
        body.code_verifier, // "verifier-1"
        body.state, // the full signed state
        "secret-access-token-xyz",
        "secret-refresh-token-xyz",
      ];
      for (const call of allCalls) {
        for (const arg of call) {
          const serialised =
            typeof arg === "string" ? arg : JSON.stringify(arg);
          for (const forbidden of forbiddenSubstrings) {
            expect(serialised).not.toContain(forbidden);
          }
        }
      }
    } finally {
      infoSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  // T-04 follow-up tracking note (see ce-review testing.json T-04):
  // We mock @/db/admin entirely; an integration test against a real RLS
  // policy that asserts a JWT-bound client receives an error on a
  // strava_tokens write belongs in a separate harness (apps/web/src/db/
  // __tests__/strava-tokens.rls.test.ts) and is tracked as a Phase B
  // follow-up.
});
