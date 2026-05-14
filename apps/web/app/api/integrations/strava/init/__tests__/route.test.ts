// Unit tests for POST /api/integrations/strava/init.
//
// Verifies:
//   - 401 when there is no authenticated user.
//   - 200 + signed state on the happy path; the returned state verifies.
//   - Bearer-token auth: a request with no cookies but a valid
//     Authorization header reaches the signer.
//   - State is NEVER logged (the state IS the verifier; logging it
//     defeats the CSRF defense).

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.hoisted(() => {
  process.env.STRAVA_OAUTH_STATE_SIGNING_KEY =
    "feedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface";
  process.env.STRAVA_TOKEN_KEYS =
    "1:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  process.env.STRAVA_CLIENT_ID = "test-client-id";
  process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

const mocks = vi.hoisted(() => {
  return {
    authUser: null as { id: string; email?: string } | null,
    lastBearerToken: undefined as string | undefined,
    getUserMock: vi.fn(),
  };
});

vi.mock("@/auth/server", () => ({
  createClient: async () => ({
    auth: {
      // supabase.auth.getUser(token?) -- our route passes the bearer
      // token explicitly via resolveAuth; capture it so the test can
      // verify the route forwards it.
      getUser: (token?: string) => {
        mocks.lastBearerToken = token;
        mocks.getUserMock(token);
        return Promise.resolve({
          data: { user: mocks.authUser },
          error: null,
        });
      },
    },
  }),
}));

import { verifyState } from "@/strava/state-nonce";

async function invokeRoute(opts: {
  headers?: Record<string, string>;
} = {}): Promise<Response> {
  const { POST } = await import("../route");
  return await POST(
    new Request("http://localhost:3000/api/integrations/strava/init", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    })
  );
}

beforeEach(() => {
  mocks.authUser = null;
  mocks.lastBearerToken = undefined;
  mocks.getUserMock.mockReset();
});

describe("POST /api/integrations/strava/init", () => {
  it("returns 401 when there is no authenticated user", async () => {
    const res = await invokeRoute();
    expect(res.status).toBe(401);
  });

  it("returns 200 + a signed state that verifies for the same user", async () => {
    mocks.authUser = { id: "user-init-1" };
    const res = await invokeRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.state).toBe("string");
    expect(verifyState("user-init-1", body.state)).toBe(true);
    // Negative: another user cannot use this state.
    expect(verifyState("user-init-2", body.state)).toBe(false);
  });

  it("forwards a Bearer token to supabase.auth.getUser (no cookie path)", async () => {
    mocks.authUser = { id: "user-bearer" };
    const res = await invokeRoute({
      headers: { Authorization: "Bearer test-jwt-value" },
    });
    expect(res.status).toBe(200);
    expect(mocks.lastBearerToken).toBe("test-jwt-value");
    // Case-insensitive scheme handled too.
    mocks.authUser = { id: "user-bearer" };
    const res2 = await invokeRoute({
      headers: { Authorization: "bearer  another-token  " },
    });
    expect(res2.status).toBe(200);
    expect(mocks.lastBearerToken).toBe("another-token");
  });

  it("falls back to cookie/undefined-token path when no Authorization header is present", async () => {
    mocks.authUser = { id: "user-cookie" };
    const res = await invokeRoute();
    expect(res.status).toBe(200);
    expect(mocks.lastBearerToken).toBeUndefined();
  });

  it("never logs the signed state value", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.authUser = { id: "user-log" };
      const res = await invokeRoute();
      expect(res.status).toBe(200);
      const body = await res.json();
      const signedState: string = body.state;
      for (const call of infoSpy.mock.calls) {
        for (const arg of call) {
          expect(JSON.stringify(arg)).not.toContain(signedState);
        }
      }
      for (const call of errSpy.mock.calls) {
        for (const arg of call) {
          expect(JSON.stringify(arg)).not.toContain(signedState);
        }
      }
    } finally {
      infoSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
