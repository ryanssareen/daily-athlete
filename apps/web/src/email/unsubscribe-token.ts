import "server-only";

// Signed unsubscribe capability tokens (U8, KTD7).
//
// R12 requires one-click unsubscribe with NO sign-in, so the link itself has to
// carry the authority. That makes this a capability token, and the whole design
// follows from bounding what the capability can do:
//
//   - It names exactly one user and one cadence, both inside the signed
//     payload. A token for the weekly digest cannot be replayed to switch off
//     the monthly one.
//   - It only ever turns a preference OFF. There is no "subscribe" token,
//     because a link that could subscribe someone would let anyone who
//     harvested one re-enable mail the athlete had deliberately stopped.
//   - It is NOT authentication. Nothing else in the app accepts it, and the
//     unsubscribe route uses it for this single state change and nothing more.
//   - It expires. An unsubscribe link in a year-old email should not still be
//     a live capability against the account.
//
// Shape and crypto mirror apps/web/src/oauth/state.ts: HMAC-SHA256 over a
// base64url payload, verified with a timing-safe comparison.

import { createHmac, timingSafeEqual } from "node:crypto";

import type { UnsubscribeCadence } from "@da2/shared";
import { UnsubscribeCadenceSchema } from "@da2/shared";

import { config } from "@/config";

/** Version marker. A future change to the payload shape bumps this so old
 * tokens fail closed rather than being reinterpreted under new rules. */
const TOKEN_VERSION = "v1";

/**
 * How long an unsubscribe link stays live.
 *
 * 180 days: comfortably longer than anyone takes to act on an email they care
 * about, and short enough that a link scraped from a long-abandoned mailbox is
 * inert. Not infinite -- a never-expiring capability against an account is a
 * liability with no upside here.
 */
export const UNSUBSCRIBE_TOKEN_TTL_S = 180 * 24 * 60 * 60;

interface TokenPayload {
  v: string;
  uid: string;
  cadence: UnsubscribeCadence;
  /** Unix seconds at which this token stops verifying. */
  exp: number;
}

export type VerifyResult =
  | { ok: true; userId: string; cadence: UnsubscribeCadence }
  | { ok: false; reason: "unconfigured" | "malformed" | "bad_signature" | "expired" };

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payloadB64: string, key: string): string {
  return createHmac("sha256", key).update(payloadB64).digest("base64url");
}

/**
 * Mint an unsubscribe token for one user and cadence.
 *
 * Returns null when no signing key is configured -- the caller (the email
 * builder) then declines to send rather than mailing a dead unsubscribe link,
 * which would be worse than not mailing at all.
 */
export function createUnsubscribeToken(
  userId: string,
  cadence: UnsubscribeCadence,
  nowMs: number = Date.now(),
): string | null {
  const key = config.email.unsubscribeSigningKey;
  if (!key) return null;

  const payload: TokenPayload = {
    v: TOKEN_VERSION,
    uid: userId,
    cadence,
    exp: Math.floor(nowMs / 1000) + UNSUBSCRIBE_TOKEN_TTL_S,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64, key)}`;
}

/**
 * Verify a token and recover the user and cadence it authorizes.
 *
 * Fails CLOSED on every ambiguity, and never reveals which check failed to the
 * caller beyond a coarse reason slug (the route renders one generic failure
 * page regardless, so a probing attacker learns nothing about whether a user id
 * exists).
 */
export function verifyUnsubscribeToken(
  token: string,
  nowMs: number = Date.now(),
): VerifyResult {
  const key = config.email.unsubscribeSigningKey;
  if (!key) return { ok: false, reason: "unconfigured" };

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed" };

  const payloadB64 = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const expectedSig = sign(payloadB64, key);

  // Timing-safe: a length mismatch is rejected before the comparison, because
  // timingSafeEqual throws on unequal lengths.
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  // Only parse AFTER the signature verifies. Parsing first would run JSON
  // decoding over attacker-controlled bytes for no reason.
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as TokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (payload?.v !== TOKEN_VERSION) return { ok: false, reason: "malformed" };
  if (typeof payload.uid !== "string" || payload.uid.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  const cadence = UnsubscribeCadenceSchema.safeParse(payload.cadence);
  if (!cadence.success) return { ok: false, reason: "malformed" };
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    return { ok: false, reason: "malformed" };
  }
  if (Math.floor(nowMs / 1000) >= payload.exp) return { ok: false, reason: "expired" };

  return { ok: true, userId: payload.uid, cadence: cadence.data };
}

/** The database column a cadence switches off. Kept here, next to the token, so
 * the mapping from "what the link authorizes" to "what gets written" is one
 * hop rather than duplicated at each call site. */
export function preferenceColumnFor(cadence: UnsubscribeCadence): string {
  return cadence === "weekly" ? "email_weekly_review" : "email_monthly_review";
}
