/**
 * Tests for the JWT verifier.
 *
 * Strategy: spin up an in-process JWKS server in `beforeAll`, generate an ES256
 * keypair, sign tokens locally with the private key, and point the verifier at
 * the local JWKS via `SUPABASE_JWT_JWKS_URL`. This exercises the real `jose`
 * verification path (no mocks of the verifier itself) without needing network.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetConfigCache } from "@/server/config";
import {
  decodeSupabaseJwt,
  extractBearer,
  InvalidTokenError,
  resetJwksCache,
  verifyBearer,
} from "@/server/auth";

import {
  mintTestKeyPair,
  serveJwks,
  signTestToken,
  type ServeJwksResult,
  type TestKeyPair,
} from "../helpers/auth";

const ISSUER = "https://test.example/auth/v1";
const AUDIENCE = "authenticated";

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
});

async function makeToken(overrides: Partial<Parameters<typeof signTestToken>[0]> = {}) {
  return signTestToken({
    sub: "11111111-1111-1111-1111-111111111111",
    privateKey: keys.privateKey,
    kid: "test-kid-1",
    issuer: ISSUER,
    audience: AUDIENCE,
    ...overrides,
  });
}

describe("decodeSupabaseJwt", () => {
  it("verifies a valid token + returns parsed claims", async () => {
    const token = await makeToken({ withClaims: { email: "alice@example.com" } });
    const claims = await decodeSupabaseJwt(token);
    expect(claims.sub).toBe("11111111-1111-1111-1111-111111111111");
    expect(claims.email).toBe("alice@example.com");
    expect(claims.role).toBe("authenticated");
  });

  it("rejects empty token", async () => {
    await expect(decodeSupabaseJwt("")).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("rejects token missing aud", async () => {
    const token = await makeToken({ omitAud: true });
    await expect(decodeSupabaseJwt(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("rejects token with wrong aud", async () => {
    const token = await makeToken({ audience: "some-other-app" });
    await expect(decodeSupabaseJwt(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("rejects token missing iss when issuer is configured", async () => {
    const token = await makeToken({ omitIss: true });
    await expect(decodeSupabaseJwt(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("rejects token with wrong iss", async () => {
    const token = await makeToken({ issuer: "https://attacker.example/auth/v1" });
    await expect(decodeSupabaseJwt(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("rejects expired token", async () => {
    const token = await makeToken({ expiresInSec: -60 });
    await expect(decodeSupabaseJwt(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("rejects a token signed by a different keypair (JWKS mismatch)", async () => {
    const otherKeys = await mintTestKeyPair("attacker-kid");
    const otherJwks = await serveJwks(otherKeys.jwks);
    try {
      const token = await signTestToken({
        sub: "22222222-2222-2222-2222-222222222222",
        privateKey: otherKeys.privateKey,
        kid: "attacker-kid",
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      // Verifier still points at OUR JWKS, not the attacker's. Token must be rejected.
      await expect(decodeSupabaseJwt(token)).rejects.toBeInstanceOf(InvalidTokenError);
    } finally {
      await otherJwks.close();
    }
  });

  it("succeeds when iss matches the configured issuer", async () => {
    const token = await makeToken();
    const claims = await decodeSupabaseJwt(token);
    expect(claims.sub).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("rejects tokens carrying a non-allowlisted role (e.g. service_role)", async () => {
    const token = await makeToken({ withClaims: { role: "service_role" } });
    await expect(decodeSupabaseJwt(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("normalizes empty-string email to undefined", async () => {
    const token = await makeToken({ withClaims: { email: "" } });
    const claims = await decodeSupabaseJwt(token);
    expect(claims.email).toBeUndefined();
  });

  it("accepts role='anon' (public anon-key sessions are valid Supabase tokens)", async () => {
    const token = await makeToken({ withClaims: { role: "anon" } });
    const claims = await decodeSupabaseJwt(token);
    expect(claims.role).toBe("anon");
  });

  it("rejects tokens whose JWKS endpoint is unreachable (closed port)", async () => {
    process.env.SUPABASE_JWT_JWKS_URL = "http://127.0.0.1:1/.well-known/jwks.json";
    resetConfigCache();
    resetJwksCache();
    const token = await makeToken();
    await expect(decodeSupabaseJwt(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });
});

describe("extractBearer", () => {
  function reqWith(authorization: string | null): Request {
    const headers = new Headers();
    if (authorization !== null) headers.set("authorization", authorization);
    return new Request("https://example/api/me", { headers });
  }

  it("extracts the token from a well-formed Authorization header", () => {
    expect(extractBearer(reqWith("Bearer abc.def.ghi"))).toBe("abc.def.ghi");
  });

  it("trims whitespace around the token", () => {
    expect(extractBearer(reqWith("Bearer    abc.def.ghi   "))).toBe("abc.def.ghi");
  });

  it("throws on missing header", () => {
    expect(() => extractBearer(reqWith(null))).toThrowError(/missing bearer token/);
  });

  it("throws on non-bearer scheme", () => {
    expect(() => extractBearer(reqWith("Basic Zm9vOmJhcg=="))).toThrowError(
      /missing bearer token/,
    );
  });

  it("throws on empty bearer token", () => {
    expect(() => extractBearer(reqWith("Bearer "))).toThrowError(/missing bearer token/);
  });

  it("throws on whitespace-only bearer token", () => {
    expect(() => extractBearer(reqWith("Bearer   \t  "))).toThrowError(
      /missing bearer token/,
    );
  });

  it("accepts lowercase 'bearer' scheme (RFC 7235 case-insensitivity)", () => {
    expect(extractBearer(reqWith("bearer abc.def.ghi"))).toBe("abc.def.ghi");
  });

  it("accepts uppercase 'BEARER' scheme", () => {
    expect(extractBearer(reqWith("BEARER abc.def.ghi"))).toBe("abc.def.ghi");
  });

  it("accepts tab-separated 'Bearer\\ttoken' (regex matches \\s+, not just space)", () => {
    expect(extractBearer(reqWith("Bearer\tabc.def.ghi"))).toBe("abc.def.ghi");
  });
});

describe("verifyBearer (end-to-end)", () => {
  function reqWith(authorization: string | null): Request {
    const headers = new Headers();
    if (authorization !== null) headers.set("authorization", authorization);
    return new Request("https://example/api/me", { headers });
  }

  it("returns claims for a valid token", async () => {
    const token = await makeToken();
    const claims = await verifyBearer(reqWith(`Bearer ${token}`));
    expect(claims.sub).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("returns generic 'invalid token' detail without leaking decode reason", async () => {
    // Tampered token
    const token = await makeToken();
    const tampered = token.slice(0, -4) + "XXXX";
    await expect(verifyBearer(reqWith(`Bearer ${tampered}`))).rejects.toMatchObject({
      status: 401,
      detail: "invalid token",
      headers: { "WWW-Authenticate": "Bearer" },
    });
  });

  it("returns 'missing bearer token' when no Authorization header is present", async () => {
    await expect(verifyBearer(reqWith(null))).rejects.toMatchObject({
      status: 401,
      detail: "missing bearer token",
    });
  });

  it("returns generic 'invalid token' detail for an expired token (no leak)", async () => {
    const token = await makeToken({ expiresInSec: -60 });
    await expect(verifyBearer(reqWith(`Bearer ${token}`))).rejects.toMatchObject({
      status: 401,
      detail: "invalid token",
    });
  });

  it("returns generic 'invalid token' detail for wrong audience (no leak)", async () => {
    const token = await makeToken({ audience: "some-other-app" });
    await expect(verifyBearer(reqWith(`Bearer ${token}`))).rejects.toMatchObject({
      status: 401,
      detail: "invalid token",
    });
  });

  it("returns generic 'invalid token' detail for wrong issuer (no leak)", async () => {
    const token = await makeToken({ issuer: "https://attacker.example/auth/v1" });
    await expect(verifyBearer(reqWith(`Bearer ${token}`))).rejects.toMatchObject({
      status: 401,
      detail: "invalid token",
    });
  });

  // RLS round-trip — deferred to Unit 3 when the actual /api/me route lands.
  // Tracked here so the gap surfaces in the test reporter.
  it.todo(
    "Unit 3: createUserScopedClient(jwt for userA) returns only userA's rows from RLS-protected query",
  );
});
