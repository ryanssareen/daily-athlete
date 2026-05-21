import "server-only";

// Admin session: a server-backed, revocable session gated by a shared
// password. Mirrors the Strava state-nonce HMAC posture (constant-time
// compare; never early-return on length) but does NOT reuse its userId-bound
// token format — the operator is not necessarily a Supabase user, and the
// session must be revocable (logout / password rotation), which a
// self-contained HMAC token cannot be.
//
// Cookie value layout: `<sessionId>.<expiresAtSeconds>.<hmacHex>`
//   - sessionId: 32 random bytes hex; also the PK of public.admin_sessions.
//   - expiresAtSeconds: absolute expiry (UTC seconds), HMAC-bound so it
//     cannot be extended client-side.
//   - hmac: HMAC-SHA256 over `<sessionId>|<expiresAtSeconds>`.
//
// verifyAdminSession() requires BOTH a valid HMAC (crypto) AND a live row
// (exists, not revoked, within idle + absolute expiry). Logout revokes the
// row; rotating ADMIN_SECRET revokes all rows. The DB row is the source of
// truth for revocation; the cookie HMAC stops forgery without a DB hit in the
// common reject case.
//
// Lockout: the per-IP failure threshold is the primary brute-force defense and
// is inherently self-DoS-resistant (an attacker on other IPs cannot lock the
// operator's distinct IP). A global threshold adds a backoff against
// distributed attacks but ONLY blocks IPs that themselves have recent
// failures — an IP with a clean record is never globally blocked, so the
// operator can always recover. See evaluateLockout().

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { config } from "@/config";
import { createAdminClient } from "@/db/admin";

// --- tuning -------------------------------------------------------------
// Only these exact numbers are "deferred" per the plan; the policy SHAPE
// (per-IP + global backoff + guaranteed self-recovery) is fixed here.
export const ABSOLUTE_SESSION_TTL_S = 12 * 60 * 60; // 12h hard cap
export const IDLE_SESSION_TTL_S = 60 * 60; // 1h since last activity
const LAST_SEEN_THROTTLE_S = 60; // don't bump last_seen more than 1x/min
export const LOCKOUT_WINDOW_S = 15 * 60; // 15m rolling window
export const PER_IP_MAX_FAILURES = 5; // per-IP lock threshold
export const GLOBAL_MAX_FAILURES = 100; // distributed-attack backoff
const ATTEMPT_RETENTION_S = 24 * 60 * 60; // prune attempts older than 24h

const HMAC_ALGO = "sha256";
const SESSION_ID_BYTES = 32;
const TOKEN_PARTS = 3;

const SESSIONS_TABLE = "admin_sessions";
const ATTEMPTS_TABLE = "admin_login_attempts";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function toIso(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

// --- crypto (pure, no DB) ----------------------------------------------

/**
 * Constant-time string compare. Always runs timingSafeEqual on
 * padded-to-equal-length buffers, then checks lengths — never early-returns on
 * length. Mirrors strava/state-nonce.ts.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  const max = Math.max(bufA.length, bufB.length, 1);
  const padA = Buffer.alloc(max);
  const padB = Buffer.alloc(max);
  bufA.copy(padA);
  bufB.copy(padB);
  const equal = timingSafeEqual(padA, padB);
  return equal && bufA.length === bufB.length;
}

function loadSigningKey(): Buffer | null {
  const raw = config.admin.sessionSigningKey;
  if (!raw) return null;
  if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length % 2 !== 0) return null;
  return Buffer.from(raw, "hex");
}

function sessionHmac(sessionId: string, expiresAt: number): string {
  const key = loadSigningKey();
  if (!key) {
    throw new Error(
      "ADMIN_SESSION_SIGNING_KEY is not configured; cannot sign admin session"
    );
  }
  return createHmac(HMAC_ALGO, key)
    .update(`${sessionId}|${expiresAt}`)
    .digest("hex");
}

/**
 * Verify the submitted password against config.admin.password in constant
 * time. Returns false when no password is configured (cannot authenticate).
 */
export function verifyAdminPassword(submitted: string): boolean {
  const expected = config.admin.password;
  if (!expected) return false;
  return constantTimeEqual(typeof submitted === "string" ? submitted : "", expected);
}

/** Sign a cookie value for a session id + absolute expiry. */
export function signSessionToken(sessionId: string, expiresAt: number): string {
  return `${sessionId}.${expiresAt}.${sessionHmac(sessionId, expiresAt)}`;
}

export interface ParsedToken {
  sessionId: string;
  expiresAt: number;
}

/**
 * Parse + cryptographically verify a cookie value WITHOUT touching the DB:
 * checks the 3-part shape, the HMAC (constant-time), and the absolute expiry.
 * Returns null on any failure. A true result still requires a live DB row
 * (see verifyAdminSession).
 */
export function parseSessionToken(
  token: string | undefined | null
): ParsedToken | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== TOKEN_PARTS) return null;
  const [sessionId, expiresAtRaw, hmac] = parts;
  if (!sessionId || !expiresAtRaw || !hmac) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isInteger(expiresAt) || expiresAt <= 0) return null;

  let expected: string;
  try {
    expected = sessionHmac(sessionId, expiresAt);
  } catch {
    return null;
  }
  if (!constantTimeEqual(hmac, expected)) return null;
  if (expiresAt <= nowSeconds()) return null;
  return { sessionId, expiresAt };
}

// --- client IP ----------------------------------------------------------

/** Minimal header reader satisfied by both `Headers` and Next's ReadonlyHeaders. */
type HeaderReader = { get(name: string): string | null };

/**
 * The client IP as Vercel reports it. `x-vercel-forwarded-for` is set by
 * Vercel's edge and is the trustworthy source; the raw `x-forwarded-for` chain
 * is client-controllable, so we only fall back to its LEFTMOST entry (the
 * original client as seen by the first trusted proxy). Returns "unknown" when
 * nothing is present (e.g. local dev) — all such requests share one lockout
 * bucket, which is fine for a single-operator tool.
 */
export function clientIp(headers: HeaderReader): string {
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return "unknown";
}

// --- CSRF ---------------------------------------------------------------

/**
 * Same-origin check via Sec-Fetch-Site, hardened to FAIL CLOSED when the
 * header is absent (admin routes are modern-browser only). Allows
 * 'same-origin' (form posts) and 'none' (direct address-bar navigation);
 * rejects 'cross-site', 'same-site', and missing.
 */
export function isSameOriginRequest(headers: Headers): boolean {
  const sfs = headers.get("sec-fetch-site");
  return sfs === "same-origin" || sfs === "none";
}

// --- session lifecycle (DB) --------------------------------------------

export interface CreatedSession {
  token: string;
  maxAgeSeconds: number;
}

/** Create a session row and return the signed cookie value + max-age. */
export async function createAdminSession(): Promise<CreatedSession> {
  const sessionId = randomBytes(SESSION_ID_BYTES).toString("hex");
  const expiresAt = nowSeconds() + ABSOLUTE_SESSION_TTL_S;
  const admin = createAdminClient();
  // service-role: admin_sessions is a service-role-only table (RLS, no
  // policies); the random session id is the row key.
  const { error } = await admin
    .from(SESSIONS_TABLE)
    .insert({ id: sessionId, expires_at: toIso(expiresAt) });
  if (error) {
    throw new Error(`createAdminSession: insert failed: ${error.message}`);
  }
  return {
    token: signSessionToken(sessionId, expiresAt),
    maxAgeSeconds: ABSOLUTE_SESSION_TTL_S,
  };
}

export interface VerifiedSession {
  valid: boolean;
  sessionId?: string;
}

/**
 * Full session verification: HMAC + a live, unrevoked, unexpired (idle +
 * absolute) DB row. Slides the idle window by bumping last_seen_at (at most
 * once per LAST_SEEN_THROTTLE_S). Safe to call from a Server Component (it
 * performs a DB write but never sets cookies).
 */
export async function verifyAdminSession(
  token: string | undefined | null
): Promise<VerifiedSession> {
  const parsed = parseSessionToken(token);
  if (!parsed) return { valid: false };

  const admin = createAdminClient();
  // service-role: admin_sessions is a service-role-only table.
  const { data, error } = await admin
    .from(SESSIONS_TABLE)
    .select("id, last_seen_at, expires_at, revoked_at")
    .eq("id", parsed.sessionId)
    .maybeSingle();
  if (error || !data) return { valid: false };
  if (data.revoked_at) return { valid: false };

  const now = nowSeconds();
  const expiresAt = Math.floor(
    new Date(data.expires_at as string).getTime() / 1000
  );
  if (expiresAt <= now) return { valid: false };

  const lastSeen = Math.floor(
    new Date(data.last_seen_at as string).getTime() / 1000
  );
  if (now - lastSeen > IDLE_SESSION_TTL_S) return { valid: false };

  if (now - lastSeen > LAST_SEEN_THROTTLE_S) {
    // service-role: admin_sessions is a service-role-only table.
    await admin
      .from(SESSIONS_TABLE)
      .update({ last_seen_at: toIso(now) })
      .eq("id", parsed.sessionId);
  }
  return { valid: true, sessionId: parsed.sessionId };
}

/** Revoke a single session (logout). Idempotent. */
export async function revokeAdminSession(sessionId: string): Promise<void> {
  const admin = createAdminClient();
  // service-role: admin_sessions is a service-role-only table.
  await admin
    .from(SESSIONS_TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("revoked_at", null);
}

/** Revoke all live sessions (e.g. after ADMIN_SECRET rotation). */
export async function revokeAllAdminSessions(): Promise<void> {
  const admin = createAdminClient();
  // service-role: admin_sessions is a service-role-only table.
  await admin
    .from(SESSIONS_TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .is("revoked_at", null);
}

// --- lockout (DB) -------------------------------------------------------

export interface LockoutDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Decide whether `ip` may attempt a login. Per-IP failures over the window
 * lock that IP; a global failure flood additionally blocks IPs that already
 * have >=1 recent failure (never a clean IP — guarantees operator
 * self-recovery). Reads only; recordLoginAttempt persists outcomes.
 */
export async function evaluateLockout(ip: string): Promise<LockoutDecision> {
  const admin = createAdminClient();
  const windowStart = toIso(nowSeconds() - LOCKOUT_WINDOW_S);

  // service-role: admin_login_attempts is a service-role-only table.
  const perIp = await admin
    .from(ATTEMPTS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .eq("success", false)
    .gte("created_at", windowStart);
  const perIpFailures = perIp.count ?? 0;
  if (perIpFailures >= PER_IP_MAX_FAILURES) {
    return { allowed: false, retryAfterSeconds: LOCKOUT_WINDOW_S };
  }

  // service-role: admin_login_attempts is a service-role-only table.
  const global = await admin
    .from(ATTEMPTS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("success", false)
    .gte("created_at", windowStart);
  const globalFailures = global.count ?? 0;
  // Global backoff only bites IPs that already have a recent failure, so an
  // operator on a clean IP is never locked out by someone else's flood.
  if (globalFailures >= GLOBAL_MAX_FAILURES && perIpFailures > 0) {
    return { allowed: false, retryAfterSeconds: LOCKOUT_WINDOW_S };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Record a login attempt outcome; opportunistically prunes old rows. */
export async function recordLoginAttempt(
  ip: string,
  success: boolean
): Promise<void> {
  const admin = createAdminClient();
  // service-role: admin_login_attempts is a service-role-only table.
  await admin.from(ATTEMPTS_TABLE).insert({ ip, success });
  // Best-effort prune so the table can't grow without bound. Cheap at this
  // volume; not on the hot read path.
  await admin
    .from(ATTEMPTS_TABLE)
    .delete()
    .lt("created_at", toIso(nowSeconds() - ATTEMPT_RETENTION_S));
}

/** Clear an IP's recent failures (called after a successful login). */
export async function clearLoginAttempts(ip: string): Promise<void> {
  const admin = createAdminClient();
  // service-role: admin_login_attempts is a service-role-only table.
  await admin.from(ATTEMPTS_TABLE).delete().eq("ip", ip).eq("success", false);
}
