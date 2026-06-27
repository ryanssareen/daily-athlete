// Low-level crypto primitives for the MCP OAuth authorization server.
//
// All pure functions with injectable secrets so they unit-test without booting
// the config/env surface. The route handlers / identity bridge pull the actual
// secret from `config.mcpOAuth` and pass it in.
//
// - Opaque tokens: 256 bits of randomness, base64url. Stored only as SHA-256
//   hashes (verify-only; the plaintext is shown to the client once and never
//   recovered), so no encryption key is needed.
// - mintSupabaseJwt: forges a short-lived Supabase-compatible HS256 JWT so a
//   per-request supabase-js client resolves `auth.uid()` and RLS scopes the
//   query. Signed with the project's legacy HS256 JWT secret (the anon key
//   decodes to alg:HS256, confirming the shared-secret model).

import { createHash, createHmac, randomBytes } from "node:crypto";

/** 256-bit opaque token, URL-safe. Used for access + refresh + auth codes. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest. The only form of a token/code that touches Postgres. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface MintJwtParams {
  userId: string;
  /** The project's legacy HS256 JWT secret (utf8 string, used as the HMAC key). */
  secret: string;
  /** NEXT_PUBLIC_SUPABASE_URL — used to build the `iss` claim. */
  supabaseUrl: string;
  /** Access-token lifetime in seconds. Kept tiny (≤60s) — it exists only for the
   *  duration of one tool call. */
  ttlSeconds?: number;
  /** Injectable clock for tests (epoch seconds). */
  nowSeconds?: number;
}

/**
 * Mint a short-lived Supabase-compatible JWT for `userId`. The claim set matches
 * what Supabase/PostgREST validate: `sub`, `role`, `aud`, `iss`, `iat`, `exp`.
 * Audience is bound to "authenticated" and the issuer to the project's auth
 * endpoint so the token cannot be confused for a service-role or cross-project
 * credential.
 */
export function mintSupabaseJwt(params: MintJwtParams): string {
  const { userId, secret, supabaseUrl, ttlSeconds = 60 } = params;
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    iss: `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`,
    iat: now,
    exp: now + ttlSeconds,
  };
  const encHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${encHeader}.${encPayload}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${sig}`;
}
