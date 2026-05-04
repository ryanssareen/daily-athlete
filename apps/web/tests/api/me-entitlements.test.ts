/**
 * Unit tests for GET /api/me/entitlements.
 *
 * Strategy mirrors `me.test.ts`: real auth, faked Supabase. Exercises the 401
 * paths and the response-shape parity that matters: an empty array when the
 * user has no entitlements, and an array of `{entitlement_key, active,
 * expires_at}` when they do.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetConfigCache } from "@/server/config";
import { resetJwksCache } from "@/server/auth";
import { resetSupabaseClientCache } from "@/server/supabase";

import {
  mintTestKeyPair,
  serveJwks,
  signTestToken,
  type ServeJwksResult,
  type TestKeyPair,
} from "../helpers/auth";
import { makeSupabaseFake } from "../helpers/supabase-fake";

const supabaseMock = vi.hoisted(() => ({
  current: null as ReturnType<typeof makeSupabaseFake>["client"] | null,
}));

vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return {
    ...actual,
    createUserScopedClient: vi.fn(() => {
      if (!supabaseMock.current) {
        throw new Error("supabaseMock.current not set — test forgot to seed");
      }
      return supabaseMock.current;
    }),
  };
});

const ISSUER = "https://test.example/auth/v1";
const AUDIENCE = "authenticated";
const USER_ID = "11111111-1111-1111-1111-111111111111";

let jwksServer: ServeJwksResult;
let keys: TestKeyPair;
let envSnapshot: typeof process.env;

beforeAll(async () => {
  envSnapshot = { ...process.env };
  keys = await mintTestKeyPair("test-kid-1");
  jwksServer = await serveJwks(keys.jwks);
});

afterAll(async () => {
  await jwksServer.close();
  process.env = envSnapshot;
});

beforeEach(() => {
  process.env = {
    ...envSnapshot,
    APP_ENV: "test",
    SUPABASE_URL: "https://test.example",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_JWT_JWKS_URL: jwksServer.url,
    SUPABASE_JWT_ISSUER: ISSUER,
    SUPABASE_JWT_AUD: AUDIENCE,
  };
  resetConfigCache();
  resetJwksCache();
  resetSupabaseClientCache();
  supabaseMock.current = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

async function bearer() {
  return signTestToken({
    sub: USER_ID,
    privateKey: keys.privateKey,
    kid: "test-kid-1",
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

function authedRequest(token: string) {
  return new Request("https://test.example/api/me/entitlements", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("GET /api/me/entitlements", () => {
  it("401 without bearer", async () => {
    const { GET } = await import("@/../app/api/me/entitlements/route");
    const res = await GET(new Request("https://test.example/api/me/entitlements"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(await res.json()).toEqual({ detail: "missing bearer token" });
  });

  it("401 with malformed bearer", async () => {
    const { GET } = await import("@/../app/api/me/entitlements/route");
    const res = await GET(
      new Request("https://test.example/api/me/entitlements", {
        headers: { Authorization: "Bearer garbage" },
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ detail: "invalid token" });
  });

  it("returns empty array when caller has no entitlements", async () => {
    supabaseMock.current = makeSupabaseFake({ entitlements: [] }).client;
    const token = await bearer();
    const { GET } = await import("@/../app/api/me/entitlements/route");
    const res = await GET(authedRequest(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns the caller's entitlement rows in EntitlementOut shape", async () => {
    supabaseMock.current = makeSupabaseFake({
      entitlements: [
        {
          user_id: USER_ID,
          entitlement_key: "ai_plans",
          active: true,
          expires_at: "2027-01-01T00:00:00Z",
        },
        {
          user_id: USER_ID,
          entitlement_key: "trend_reports",
          active: false,
          expires_at: null,
        },
      ],
    }).client;
    const token = await bearer();
    const { GET } = await import("@/../app/api/me/entitlements/route");
    const res = await GET(authedRequest(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    // Each row has only the public columns — no user_id leak.
    for (const row of body) {
      expect(Object.keys(row).sort()).toEqual(["active", "entitlement_key", "expires_at"]);
    }
    expect(body).toEqual([
      { entitlement_key: "ai_plans", active: true, expires_at: "2027-01-01T00:00:00Z" },
      { entitlement_key: "trend_reports", active: false, expires_at: null },
    ]);
  });

  it("filters by user_id (does not return rows for other users)", async () => {
    const otherUserId = "22222222-2222-2222-2222-222222222222";
    supabaseMock.current = makeSupabaseFake({
      entitlements: [
        {
          user_id: otherUserId,
          entitlement_key: "ai_plans",
          active: true,
          expires_at: null,
        },
      ],
    }).client;
    const token = await bearer();
    const { GET } = await import("@/../app/api/me/entitlements/route");
    const res = await GET(authedRequest(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("500 if Supabase returns an unexpected error", async () => {
    supabaseMock.current = makeSupabaseFake(
      { entitlements: [] },
      { failNextSelect: { table: "entitlements", error: { message: "boom" } } },
    ).client;
    const token = await bearer();
    const { GET } = await import("@/../app/api/me/entitlements/route");
    const res = await GET(authedRequest(token));
    expect(res.status).toBe(500);
    // Detail is generic — we never surface raw DB errors to the wire.
    expect(await res.json()).toEqual({ detail: "internal error" });
  });
});
