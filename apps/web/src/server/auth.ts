/**
 * Supabase JWT verifier.
 *
 * Production project (verified in Unit-0 preflight) signs JWTs with ES256 +
 * asymmetric keys served at `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`.
 * We verify against that JWKS via `jose.createRemoteJWKSet`, which caches the
 * key set with sensible defaults and follows `kid` rotation automatically.
 *
 * Required claims: sub, exp, aud. The issuer is pinned in non-dev environments
 * (config validation refuses to boot otherwise). The verifier never echoes the
 * underlying decode reason in HTTP 401 responses — ce:review hardening to avoid
 * leaking "expired" vs "bad signature" timing/info to attackers.
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
  _jwks = createRemoteJWKSet(new URL(cfg.supabaseJwtJwksUrl));
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
      audience: cfg.supabaseJwtAud,
      issuer: cfg.supabaseJwtIssuer || undefined,
      requiredClaims: ["sub", "exp", "aud"],
    });
    if (typeof payload.sub !== "string" || !payload.sub) {
      throw new InvalidTokenError("missing sub");
    }
    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      role: typeof payload.role === "string" ? payload.role : "authenticated",
    };
  } catch (err) {
    if (err instanceof InvalidTokenError) throw err;
    if (err instanceof JOSEError) {
      throw new InvalidTokenError(err.code || err.message);
    }
    throw new InvalidTokenError("verify failed");
  }
}

/** Pull a bearer token off an incoming Request. Empty/missing → throws. */
export function extractBearer(request: Request): string {
  const header = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!header || !/^bearer\s/i.test(header)) {
    throw Unauthorized("missing bearer token");
  }
  const token = header.slice(header.indexOf(" ") + 1).trim();
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
