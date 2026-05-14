// Unit tests for POST /api/integrations/strava/connect.
//
// The route depends on:
// - @/auth/server.createClient (JWT-bound SSR client) for auth.uid()
// - @/db/admin.createAdminClient (service-role) for strava_tokens writes
// - inngest.send (event queue dispatch)
// - exchangeAuthorizationCode -> Strava /oauth/token (msw'd)
//
// We mock the first three via vi.mock and intercept Strava's HTTP surface
// with msw. The result is a fast route-level test that exercises the
// branching matrix (state mismatch, invalid code, collision, happy path,
// Inngest failure -> still 200) without needing a live Postgres or live
// Inngest.

// vi.hoisted runs BEFORE ESM imports are evaluated, which is the only
// reliable way to seed env vars that client.ts / config.ts read at module
// load time.
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

// Hoisted-safe mock storage. vi.mock factories run before the test file
// body executes, so module-scoped lets won't be initialised yet -- use
// vi.hoisted to declare cross-scope state.
const mocks = vi.hoisted(() => {
  return {
    authUser: null as { id: string; email?: string } | null,
    adminFake: null as null | {
      tokensByUser: Map<string, RowState>;
      ownerLookup: Map<number, string>;
      lastUpsert?: RowState;
    },
    inngestSend: vi.fn(),
  };
});

interface RowState {
  user_id: string;
  access_token_enc: Uint8Array;
  refresh_token_enc: Uint8Array;
  expires_at: string;
  scope: string;
  athlete_strava_id: number;
  key_version: number;
}

vi.mock("@/auth/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: mocks.authUser },
        error: null,
      }),
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
    mocks.adminFake.tokensByUser.set(row.user_id, row);
    mocks.adminFake.ownerLookup.set(row.athlete_strava_id, row.user_id);
    mocks.adminFake.lastUpsert = row;
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
  mocks.adminFake = {
    tokensByUser: new Map(),
    ownerLookup: new Map(),
  };
  mocks.inngestSend.mockReset();
  mocks.inngestSend.mockResolvedValue({ ids: ["evt_1"] });
});

afterEach(() => server.resetHandlers());

async function invokeRoute(body: unknown): Promise<Response> {
  // Dynamic import so vi.mock above takes effect before module evaluation.
  const { POST } = await import("../route");
  return await POST(
    new Request("http://localhost:3000/api/integrations/strava/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const validBody = {
  code: "auth-code-1",
  code_verifier: "verifier-1",
  redirect_uri: "https://example.com/cb",
  state: "state-1",
  expected_state: "state-1",
};

describe("POST /api/integrations/strava/connect", () => {
  it("returns 401 when there is no authenticated user", async () => {
    const res = await invokeRoute(validBody);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 400 with state_mismatch when state != expected_state", async () => {
    mocks.authUser = { id: "user-a" };
    const res = await invokeRoute({
      ...validBody,
      state: "state-1",
      expected_state: "state-2",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("state_mismatch");
    // No Strava call was made (no authorize attempts).
    expect(mockState.authorizeCalls).toHaveLength(0);
  });

  it("returns 400 invalid_input on a Zod-rejected body (missing code_verifier)", async () => {
    mocks.authUser = { id: "user-a" };
    const res = await invokeRoute({
      code: "x",
      redirect_uri: "https://example.com/cb",
      state: "s",
      expected_state: "s",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("on happy path: persists encrypted tokens, enqueues backfill, returns 200", async () => {
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

    const res = await invokeRoute(validBody);
    expect(res.status).toBe(200);
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
    // The persisted bytes should NOT equal the plaintext.
    expect(persisted.access_token_enc).toBeInstanceOf(Uint8Array);
    expect(
      new TextDecoder().decode(persisted.access_token_enc)
    ).not.toContain("access-1");

    // Backfill event enqueued.
    expect(mocks.inngestSend).toHaveBeenCalledWith({
      name: "strava/backfill.start",
      data: { user_id: "user-happy" },
    });
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

    const res = await invokeRoute(validBody);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("strava_account_already_linked");

    // Critically: the original owner's row is NOT overwritten.
    expect(mocks.adminFake!.tokensByUser.get("user-collider")).toBeUndefined();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("returns 400 strava_rejected_code when Strava 400s on the exchange", async () => {
    mocks.authUser = { id: "user-bad-code" };
    mockState.authorize.push({ kind: "invalid-code" });

    const res = await invokeRoute(validBody);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("strava_rejected_code");
    // Token write was not attempted.
    expect(mocks.adminFake!.tokensByUser.size).toBe(0);
  });

  it("still returns 200 if Inngest enqueue fails after a successful token write", async () => {
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

    const res = await invokeRoute(validBody);
    expect(res.status).toBe(200);

    // Token row still persisted -- soft failure on the enqueue.
    expect(mocks.adminFake!.tokensByUser.get("user-inngest-down")).toBeDefined();
  });

  it("returns 502 strava_unreachable when Strava /oauth/token throws a network error", async () => {
    mocks.authUser = { id: "user-net" };
    // No queued authorize -> the handler returns 500 with "no authorize
    // mock". Simulate a true network failure by removing the handler.
    server.resetHandlers(); // strip all msw handlers
    server.use(); // no Strava handler at all -> msw onUnhandledRequest error -> fetch rejects

    const res = await invokeRoute(validBody);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("strava_unreachable");
  });
});
