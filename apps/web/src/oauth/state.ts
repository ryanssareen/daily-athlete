// HMAC-signed `state` for the MCP OAuth flow.
//
// The /authorize handler must carry its validated request context (client_id,
// redirect_uri, PKCE challenge, resource, scope, the client's own `state`)
// across the bounce to Supabase login and back. Holding that in a server-signed
// token — rather than a client-supplied round-trip value — means the returning
// request can't be tampered with: the attacker never holds the signing key.
//
// This mirrors the audited Strava OAuth state-nonce design
// (apps/web/src/strava/state-nonce.ts, docs/solutions/strava-oauth.md):
//   - HMAC-SHA256 over the encoded payload, key held only by the server
//   - timing-safe comparison of the server-recomputed signature
//   - a TTL bound (default 600s) checked against an embedded `iat`
//   - the token is NEVER logged
//
// The signing key is the 32-byte hex `MCP_OAUTH_STATE_SIGNING_KEY`; callers pass
// it in (from `config.mcpOAuth.stateSigningKey`) so this module stays pure.

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_MAX_AGE_MS = 600_000; // 10 minutes
const CLOCK_SKEW_MS = 60_000;

function sign(encBody: string, keyHex: string): Buffer {
  return createHmac("sha256", Buffer.from(keyHex, "hex")).update(encBody).digest();
}

/** Sign an arbitrary JSON-serializable payload. An `iat` is stamped for TTL. */
export function signState(
  payload: Record<string, unknown>,
  keyHex: string,
  nowMs?: number
): string {
  const body = { ...payload, iat: nowMs ?? Date.now() };
  const encBody = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = sign(encBody, keyHex).toString("base64url");
  return `${encBody}.${sig}`;
}

/**
 * Verify a signed state token. Returns the payload (minus `iat`) on success, or
 * `null` on any failure (bad shape, bad signature, expired, future-dated).
 * The signature compare is constant-time over the server-recomputed HMAC — this
 * is a true verification (server holds the key), not a symmetric compare of two
 * client-controlled values.
 */
export function verifyState<T = Record<string, unknown>>(
  token: string,
  keyHex: string,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
  nowMs?: number
): T | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const encBody = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  const expected = sign(encBody, keyHex); // 32 raw bytes
  let provided: Buffer;
  try {
    provided = Buffer.from(providedSig, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  let body: Record<string, unknown> & { iat?: unknown };
  try {
    body = JSON.parse(Buffer.from(encBody, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const iat = typeof body.iat === "number" ? body.iat : null;
  if (iat === null) return null;
  const now = nowMs ?? Date.now();
  // Expired, or implausibly future-dated (clock skew tolerated).
  if (now - iat > maxAgeMs) return null;
  if (iat - now > CLOCK_SKEW_MS) return null;

  const rest = { ...body };
  delete rest.iat;
  return rest as T;
}
