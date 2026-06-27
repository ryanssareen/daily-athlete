// PKCE (RFC 7636) verification for the MCP OAuth flow.
//
// The connector advertises only S256 and rejects `plain` (and a missing method)
// at /authorize, so this module verifies S256 exclusively: the stored
// `code_challenge` must equal base64url(SHA-256(code_verifier)).

import { createHash, timingSafeEqual } from "node:crypto";

/** RFC 7636 §4.1: verifier is 43–128 chars from the unreserved set. */
export function isValidCodeVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(verifier);
}

/** `true` only when method is exactly "S256". `plain` and undefined are rejected. */
export function isS256Method(method: string | null | undefined): boolean {
  return method === "S256";
}

/** Constant-time check that base64url(SHA-256(verifier)) === challenge. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  const computed = createHash("sha256").update(verifier).digest(); // 32 bytes
  let provided: Buffer;
  try {
    provided = Buffer.from(challenge, "base64url");
  } catch {
    return false;
  }
  return provided.length === computed.length && timingSafeEqual(provided, computed);
}
