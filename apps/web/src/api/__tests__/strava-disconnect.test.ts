// Unit tests for DELETE /api/integrations/strava/disconnect
//
// The route depends on:
// - @/auth/server.createClient + resolveAuth (Bearer header)
// - @/db/admin.createAdminClient (service-role) for strava_tokens reads + delete
// - @/security/token-crypto.decrypt (to decrypt token for Strava deauthorize)
// - fetch (global) intercepted with msw for the Strava deauthorize call
//
// All external dependencies are mocked via vi.mock.
//
// Scenarios:
// - valid auth → 204, row deleted
// - no strava_tokens row → 404
// - missing Bearer → 401
// - Strava deauthorize fails → still 204, row deleted (non-blocking)

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
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  // strava_tokens rows: null means row does not exist.
  tokenRow: null as {
    user_id: string;
    access_token_enc: string;
    key_version: number;
  } | null,
  // Captures the user_id filter on the DELETE call.
  deletedUserId: null as string | null,
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/auth/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: (_token?: string) =>
        Promise.resolve({ data: { user: state.authUser }, error: null }),
    },
  }),
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => new FakeAdminClient(),
}));

// Stub decrypt to return a known plaintext without real crypto.
vi.mock("@/security/token-crypto", () => ({
  decrypt: (_ciphertext: Uint8Array, _keyVersion: number): Uint8Array =>
    new TextEncoder().encode("stub-access-token"),
}));

class FakeAdminClient {
  from(table: string) {
    if (table !== "strava_tokens") {
      throw new Error(`unexpected table: ${table}`);
    }
    return new FakeTokensQueryBuilder();
  }
}

class FakeTokensQueryBuilder {
  private _op: "select" | "delete" | null = null;
  private _eqUserId: string | null = null;

  select(_cols: string) {
    this._op = "select";
    return this;
  }

  delete() {
    this._op = "delete";
    return this;
  }

  eq(col: string, val: unknown) {
    if (col === "user_id") this._eqUserId = val as string;
    return this;
  }

  async maybeSingle() {
    // SELECT path: return the current tokenRow or null.
    if (state.tokenRow === null) return { data: null, error: null };
    return { data: state.tokenRow, error: null };
  }

  // The route uses `await admin.from(...).delete().eq(...)`.
  // Supabase-js query builders resolve via implicit Promise when awaited.
  // We make this builder thenable so it resolves on the delete path.
  then(
    resolve: (v: { error: null }) => unknown,
    _reject?: (e: unknown) => unknown,
  ) {
    if (this._op === "delete") {
      state.deletedUserId = this._eqUserId;
    }
    return Promise.resolve({ error: null }).then(resolve);
  }
}

// ---------------------------------------------------------------------------
// MSW — Strava deauthorize endpoint
// ---------------------------------------------------------------------------

const stravaDeauthorizeCalls: string[] = [];

const server = setupServer(
  http.post("https://www.strava.com/oauth/deauthorize", async ({ request }) => {
    stravaDeauthorizeCalls.push(await request.text());
    return HttpResponse.json({ athlete: { id: 1234 } }, { status: 200 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  state.authUser = null;
  state.tokenRow = null;
  state.deletedUserId = null;
  stravaDeauthorizeCalls.length = 0;
});

afterEach(() => server.resetHandlers());

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function invokeRoute(
  opts: { headers?: Record<string, string> } = {},
): Promise<Response> {
  const { DELETE } = await import(
    "../../../app/api/integrations/strava/disconnect/route"
  );
  return DELETE(
    new Request(
      "http://localhost:3000/api/integrations/strava/disconnect",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
      },
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DELETE /api/integrations/strava/disconnect", () => {
  it("returns 401 when no authenticated user", async () => {
    state.authUser = null;
    const res = await invokeRoute();
    expect(res.status).toBe(401);
  });

  it("returns 401 with missing Bearer token (authUser is null)", async () => {
    const res = await invokeRoute({ headers: {} });
    expect(res.status).toBe(401);
  });

  it("returns 404 when no strava_tokens row exists for user", async () => {
    state.authUser = { id: "user-no-token" };
    state.tokenRow = null; // no row

    const res = await invokeRoute({
      headers: { Authorization: "Bearer valid-jwt" },
    });
    expect(res.status).toBe(404);
  });

  it("returns 204 and deletes the row on happy path", async () => {
    state.authUser = { id: "user-happy" };
    state.tokenRow = {
      user_id: "user-happy",
      access_token_enc: "\\x737475622d6163636573732d746f6b656e", // hex for stub
      key_version: 1,
    };

    const res = await invokeRoute({
      headers: { Authorization: "Bearer valid-jwt" },
    });
    expect(res.status).toBe(204);

    // DELETE must have been issued, scoped to the caller's user_id.
    expect(state.deletedUserId).toBe("user-happy");
  });

  it("calls Strava deauthorize on happy path", async () => {
    state.authUser = { id: "user-deauth" };
    state.tokenRow = {
      user_id: "user-deauth",
      access_token_enc: "\\x737475622d6163636573732d746f6b656e",
      key_version: 1,
    };

    const res = await invokeRoute({
      headers: { Authorization: "Bearer valid-jwt" },
    });
    expect(res.status).toBe(204);
    expect(stravaDeauthorizeCalls.length).toBe(1);
    expect(stravaDeauthorizeCalls[0]).toContain("access_token=");
  });

  it("still returns 204 and deletes even if Strava deauthorize fails", async () => {
    state.authUser = { id: "user-strava-down" };
    state.tokenRow = {
      user_id: "user-strava-down",
      access_token_enc: "\\x737475622d6163636573732d746f6b656e",
      key_version: 1,
    };

    // Override Strava to return 500.
    server.use(
      http.post(
        "https://www.strava.com/oauth/deauthorize",
        () =>
          HttpResponse.json(
            { error: "service_unavailable" },
            { status: 500 },
          ),
      ),
    );

    const res = await invokeRoute({
      headers: { Authorization: "Bearer valid-jwt" },
    });
    // Strava failure is non-blocking — must still return 204.
    expect(res.status).toBe(204);
    // Row must still have been deleted before the Strava call was attempted.
    expect(state.deletedUserId).toBe("user-strava-down");
  });
});
