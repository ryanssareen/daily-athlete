// Server-signed state nonce for the Strava OAuth flow.
//
// The mobile client cannot mint its own state because the signing key
// (`STRAVA_OAUTH_STATE_SIGNING_KEY`) never leaves the server. POST
// /api/integrations/strava/init returns a signed state bound to the
// authenticated user_id and a 10-minute expiry; mobile passes it through
// to Strava as the OAuth state parameter, Strava echoes it back on the
// callback, and the /connect route HMAC-verifies it.
//
// Layout: `<nonceHex>.<expiresAtSeconds>.<hmacHex>`.
//
//   - nonce: 16 bytes of randomBytes, hex-encoded. Adds entropy so a
//     replay across the 10-minute window is still detectable in logs
//     (each authorize attempt has a unique nonce).
//   - expiresAtSeconds: integer UTC seconds. The HMAC binds it so an
//     attacker cannot extend a stale state.
//   - hmac: HMAC-SHA256 over `${userId}|${nonce}|${expiresAt}` with the
//     env-loaded signing key. Hex-encoded.
//
// Verification rules:
//   - Reject malformed strings (wrong segment count).
//   - Reject expired states.
//   - Compare HMACs in constant time on padded-to-equal-length buffers
//     (always run timingSafeEqual; do not early-return on length).
//   - Returns false on ANY error path; no partial-success signals.
//
// The signing key is required in production. config.ts warns in dev/test
// when it's missing -- callers that need a working key in dev must set
// STRAVA_OAUTH_STATE_SIGNING_KEY explicitly.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { config } from "@/config";

const NONCE_BYTES = 16;
const HMAC_ALGO = "sha256";
const PARTS_COUNT = 3;

function loadSigningKey(): Buffer | null {
  const raw = config.strava.stateSigningKey;
  if (!raw) return null;
  // The key arrives as hex (validated in config.ts). Convert to bytes
  // once -- a 32-byte HMAC key is the standard SHA-256 input size.
  if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length % 2 !== 0) return null;
  return Buffer.from(raw, "hex");
}

function hmacHex(userId: string, nonce: string, expiresAt: number): string {
  const key = loadSigningKey();
  if (!key) {
    throw new Error(
      "STRAVA_OAUTH_STATE_SIGNING_KEY is not configured; cannot sign state"
    );
  }
  return createHmac(HMAC_ALGO, key)
    .update(`${userId}|${nonce}|${expiresAt}`)
    .digest("hex");
}

/**
 * Sign a fresh state for `userId`, valid for `ttlSeconds` from now.
 *
 * Throws if the signing key is missing in env -- callers in production
 * cannot proceed without it, and the eager throw makes a misconfiguration
 * loud at the /init route rather than silently emitting unverifiable
 * states.
 */
export function signState(userId: string, ttlSeconds: number): string {
  const nonce = randomBytes(NONCE_BYTES).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const hmac = hmacHex(userId, nonce, expiresAt);
  return `${nonce}.${expiresAt}.${hmac}`;
}

/**
 * Verify a state string against the authenticated user_id.
 *
 * Returns true iff:
 *   - the string parses to exactly three dot-separated parts
 *   - the expiry hasn't passed
 *   - the HMAC matches what we'd compute for these `(userId, nonce, expiresAt)` inputs
 *
 * Returns false on every other input (including missing signing key).
 * Never throws -- the route handler should call this and branch on the
 * boolean.
 */
export function verifyState(userId: string, signedState: string): boolean {
  if (typeof signedState !== "string") return false;
  const parts = signedState.split(".");
  if (parts.length !== PARTS_COUNT) return false;

  const [nonce, expiresAtRaw, hmac] = parts;
  if (!nonce || !expiresAtRaw || !hmac) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isInteger(expiresAt) || expiresAt <= 0) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const notExpired = expiresAt > nowSeconds;

  let expectedHmac: string;
  try {
    expectedHmac = hmacHex(userId, nonce, expiresAt);
  } catch {
    // Signing key missing or unreadable. Refuse rather than letting any
    // state pass.
    return false;
  }

  // Always run timingSafeEqual on equal-length buffers -- never early-return
  // on length mismatch. Pad both to max length, then check the lengths
  // afterward. This keeps the comparison's runtime independent of how the
  // attacker-supplied hmac differs from the expected one.
  const provided = Buffer.from(hmac, "utf8");
  const expected = Buffer.from(expectedHmac, "utf8");
  const max = Math.max(provided.length, expected.length);
  const a = Buffer.alloc(max);
  const b = Buffer.alloc(max);
  provided.copy(a);
  expected.copy(b);
  const equal = timingSafeEqual(a, b);
  const sameLength = provided.length === expected.length;
  return notExpired && sameLength && equal;
}
