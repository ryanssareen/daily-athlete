/**
 * Unit tests for /api/me (GET + PATCH).
 *
 * Strategy: real auth verifier (in-process JWKS over an ES256 keypair), faked
 * Supabase client (the route handler depends on the supabase-js fluent
 * builder, not on a real PostgREST). Real-PostgREST behavior is covered by
 * the Playwright e2e suite against the deployed project.
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

// Hoisted mock controller — all tests in this file share one fake-client
// reference that they swap before each test.
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

async function bearerFor(sub = USER_ID, extra: Record<string, unknown> = {}) {
  return signTestToken({
    sub,
    privateKey: keys.privateKey,
    kid: "test-kid-1",
    issuer: ISSUER,
    audience: AUDIENCE,
    withClaims: extra,
  });
}

function jsonRequest(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request("https://test.example/api/me", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const sampleUser = {
  id: USER_ID,
  email: "alice@example.test",
  display_name: "Alice",
  role_flags: ["athlete"],
  timezone: "UTC",
  created_at: "2026-05-01T00:00:00Z",
  deleted_at: null,
};

describe("GET /api/me", () => {
  it("401 without bearer; carries WWW-Authenticate and 'missing bearer token'", async () => {
    const { GET } = await import("@/../app/api/me/route");
    const res = await GET(new Request("https://test.example/api/me"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(await res.json()).toEqual({ detail: "missing bearer token" });
  });

  it("401 with malformed token; detail is generic 'invalid token' (no leak)", async () => {
    const { GET } = await import("@/../app/api/me/route");
    const res = await GET(
      new Request("https://test.example/api/me", {
        headers: { Authorization: "Bearer not-a-real-jwt" },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    const body = await res.json();
    expect(body).toEqual({ detail: "invalid token" });
    // Sanity: no decode reason leaked
    expect(JSON.stringify(body)).not.toMatch(/expired|signature|jwt/i);
  });

  it("200 with valid bearer + matching user; response shape mirrors UserOut", async () => {
    supabaseMock.current = makeSupabaseFake({ users: [sampleUser] }).client;
    const token = await bearerFor();
    const { GET } = await import("@/../app/api/me/route");
    const res = await GET(
      new Request("https://test.example/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // deleted_at must NOT appear in the public shape (parity with UserOut)
    expect(body).toEqual({
      id: USER_ID,
      email: "alice@example.test",
      display_name: "Alice",
      role_flags: ["athlete"],
      timezone: "UTC",
      created_at: "2026-05-01T00:00:00Z",
    });
    expect("deleted_at" in body).toBe(false);
  });

  it("404 when caller's row exists but is soft-deleted", async () => {
    supabaseMock.current = makeSupabaseFake({
      users: [{ ...sampleUser, deleted_at: "2026-04-01T00:00:00Z" }],
    }).client;
    const token = await bearerFor();
    const { GET } = await import("@/../app/api/me/route");
    const res = await GET(
      new Request("https://test.example/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ detail: "user not found" });
  });

  it("404 when caller's row doesn't exist at all", async () => {
    supabaseMock.current = makeSupabaseFake({ users: [] }).client;
    const token = await bearerFor();
    const { GET } = await import("@/../app/api/me/route");
    const res = await GET(
      new Request("https://test.example/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/me", () => {
  it("200 with display_name update, response reflects new value", async () => {
    const fake = makeSupabaseFake({ users: [sampleUser] });
    supabaseMock.current = fake.client;
    const token = await bearerFor();
    const { PATCH } = await import("@/../app/api/me/route");
    const req = new Request("https://test.example/api/me", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: "Alice Updated" }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.display_name).toBe("Alice Updated");
    // Underlying row was actually mutated in the fake (proves PATCH→GET integration is consistent)
    expect(fake.rows.users[0].display_name).toBe("Alice Updated");
  });

  it("400 when display_name is empty string", async () => {
    supabaseMock.current = makeSupabaseFake({ users: [sampleUser] }).client;
    const token = await bearerFor();
    const { PATCH } = await import("@/../app/api/me/route");
    const req = new Request("https://test.example/api/me", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: "" }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("400 when display_name exceeds 120 chars", async () => {
    supabaseMock.current = makeSupabaseFake({ users: [sampleUser] }).client;
    const token = await bearerFor();
    const longName = "x".repeat(121);
    const { PATCH } = await import("@/../app/api/me/route");
    const req = new Request("https://test.example/api/me", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: longName }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("400 when timezone exceeds 64 chars", async () => {
    supabaseMock.current = makeSupabaseFake({ users: [sampleUser] }).client;
    const token = await bearerFor();
    const { PATCH } = await import("@/../app/api/me/route");
    const req = new Request("https://test.example/api/me", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "x".repeat(65) }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("400 on malformed JSON body", async () => {
    supabaseMock.current = makeSupabaseFake({ users: [sampleUser] }).client;
    const token = await bearerFor();
    const { PATCH } = await import("@/../app/api/me/route");
    const req = new Request("https://test.example/api/me", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{not-json",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("404 PATCH when caller is soft-deleted", async () => {
    supabaseMock.current = makeSupabaseFake({
      users: [{ ...sampleUser, deleted_at: "2026-04-01T00:00:00Z" }],
    }).client;
    const token = await bearerFor();
    const { PATCH } = await import("@/../app/api/me/route");
    const req = new Request("https://test.example/api/me", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: "ghost" }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(404);
  });

  it("integration: PATCH then GET reflects the change without a 'stale read'", async () => {
    const fake = makeSupabaseFake({ users: [sampleUser] });
    supabaseMock.current = fake.client;
    const token = await bearerFor();

    const { PATCH, GET } = await import("@/../app/api/me/route");
    const patchRes = await PATCH(
      new Request("https://test.example/api/me", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: "Bob" }),
      }),
    );
    expect(patchRes.status).toBe(200);

    const getRes = await GET(
      new Request("https://test.example/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).display_name).toBe("Bob");
  });
});
