/**
 * Supabase JWT verifier.
 *
 * Production project (verified in Unit-0 preflight) signs JWTs with ES256 +
 * asymmetric keys served at `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`.
 * We verify against that JWKS via `jose.createRemoteJWKSet`, which caches the
 * key set with explicit timeout/cooldown bounds (set below) and follows `kid`
 * rotation automatically.
 *
 * Required claims: sub, exp, aud. The issuer is pinned in non-dev environments
 * (config validation refuses to boot otherwise). The verifier never echoes the
 * underlying decode reason in HTTP 401 responses — ce:review hardening to avoid
 * leaking "expired" vs "bad signature" timing/info to attackers.
 *
 * `algorithms: ["ES256"]` is passed to `jwtVerify` belt-and-suspenders even
 * though the JWKS resolver already constrains accepted algorithms to those
 * advertised by the keys; the explicit allowlist is self-documenting.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import { JOSEError } from "jose/errors";

import { getConfig } from "@/server/config";
import { Unauthorized } from "@/server/errors";

export interface SupabaseClaims {
  sub: string;
  email: string | undefined;
  role: string;
}

const ALLOWED_ROLES = new Set(["authenticated", "anon"]);

export class InvalidTokenError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "InvalidTokenError";
  }
}

let _jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function jwks(): ReturnType<typeof createRemoteJWKSet> {
  if (_jwks) return _jwks;
  const cfg = getConfig();
  if (!cfg.supabaseJwtJwksUrl) {
    throw new InvalidTokenError("JWKS URL not configured");
  }
  _jwks = createRemoteJWKSet(new URL(cfg.supabaseJwtJwksUrl), {
    // Pin below the typical Vercel function budget so a slow IdP can't eat
    // the entire request window.
    timeoutDuration: 3_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
  });
  return _jwks;
}

/** Test helper. */
export function resetJwksCache(): void {
  _jwks = undefined;
}

export async function decodeSupabaseJwt(token: string): Promise<SupabaseClaims> {
  if (!token) {
    throw new InvalidTokenError("empty token");
  }
  const cfg = getConfig();
  try {
    const { payload } = await jwtVerify(token, jwks(), {
      algorithms: ["ES256"],
      audience: cfg.supabaseJwtAud,
      issuer: cfg.supabaseJwtIssuer || undefined,
      requiredClaims: ["sub", "exp", "aud"],
    });
    if (typeof payload.sub !== "string" || !payload.sub) {
      throw new InvalidTokenError("missing sub");
    }
    const role = typeof payload.role === "string" ? payload.role : "authenticated";
    if (!ALLOWED_ROLES.has(role)) {
      throw new InvalidTokenError(`disallowed role: ${role}`);
    }
    const rawEmail = payload.email;
    const email = typeof rawEmail === "string" && rawEmail.length > 0 ? rawEmail : undefined;
    return {
      sub: payload.sub,
      email,
      role,
    };
  } catch (err) {
    if (err instanceof InvalidTokenError) throw err;
    if (err instanceof JOSEError) {
      throw new InvalidTokenError(err.code || err.message);
    }
    throw new InvalidTokenError("verify failed");
  }
}

/**
 * Pull a bearer token off an incoming Request. Throws Unauthorized on
 * missing / wrong-scheme / empty-token.
 *
 * The Fetch API's Headers.get is case-insensitive (per the spec), so a single
 * `.get("authorization")` call covers `Authorization`, `AUTHORIZATION`, etc.
 * The scheme regex matches any whitespace via `\s+` and we use the same regex
 * to capture the token, so tab/multi-space separators parse consistently
 * (previously the regex accepted `\s` but indexOf only split on a literal
 * space, causing tab-separated headers to be misparsed).
 */
const BEARER_RE = /^bearer\s+(.+)$/i;

export function extractBearer(request: Request): string {
  const header = request.headers.get("authorization");
  if (!header) {
    throw Unauthorized("missing bearer token");
  }
  const match = BEARER_RE.exec(header);
  if (!match) {
    throw Unauthorized("missing bearer token");
  }
  const token = match[1].trim();
  if (!token) {
    throw Unauthorized("missing bearer token");
  }
  return token;
}

/** End-to-end: pull bearer + verify. Throws ApiError(401) on failure. */
export async function verifyBearer(request: Request): Promise<SupabaseClaims> {
  const token = extractBearer(request);
  try {
    return await decodeSupabaseJwt(token);
  } catch (err) {
    void err; // intentionally don't leak the reason to the client
    throw Unauthorized();
  }
}
