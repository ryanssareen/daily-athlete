// Per-user Strava API client. Constructed with a validated user_id + a
// service-role supabase-js admin client.
//
// CRITICAL: the caller (route handler / Inngest function) MUST first
// confirm `auth.uid() === userId` via the JWT-bound client BEFORE handing
// the user_id to this factory. The strava_tokens table has no
// INSERT/UPDATE RLS policy -- writes here bypass RLS by design (see
// AGENTS.md "Secrets" + the migration 0002 comment block). Every
// service-role write site below carries an explicit:
//   // service-role: explicit user filter required
//
// Lifecycle of a fetch():
//   1. Load encrypted tokens from DB (service-role; filtered by user_id).
//   2. Decrypt access_token via token-crypto.decrypt(buf, keyVersion).
//   3. Issue GET/POST to https://www.strava.com/api/v3{path} with Bearer.
//   4. Capture rate-limit headers into `rateLimits`.
//   5. On 401:
//      - Inspect response body. If body reads as a rate-limit indication
//        (Strava sometimes uses 401 for daily-quota exhaustion), throw
//        StravaRateLimited -- DO NOT refresh.
//      - Otherwise: POST /oauth/token (grant_type=refresh_token). Atomic
//        UPDATE persists BOTH new access_token AND new refresh_token
//        (Strava rotates both) plus expires_at + key_version in a single
//        statement. Re-read the row from DB on retry so a concurrent
//        refresh's loser picks up the winner's fresh tokens. Retry the
//        original request once; on a second 401 throw StravaReauthRequired
//        (the typed error is more useful to Inngest callers than a bare
//        Response).
//   6. On 429 from a regular fetch: return the 429 response. Caller (the
//      backfill Inngest function) decides retry strategy via step.sleep --
//      client must not auto-retry on rate limits.
//   7. On 401 from the refresh endpoint itself: throw StravaReauthRequired.
//
// `touchLastUsed()` is explicit-only -- the client does NOT call it on
// every fetch. Phase C/D callers invoke it once per logical session so a
// 200-activity backfill doesn't generate 200 UPDATE writes. Phase B has no
// caller for it; the method exists so C/D can ship without revisiting.
//
// BYTEA serialisation:
//   Writes pass ciphertext as `\x<hex>` strings; supabase-js JSON.stringifies
//   the body and PostgREST needs the BYTEA hex literal form. Reads come back
//   as either `\x<hex>` (PostgREST default) or base64 (legacy supabase-js);
//   `decodeBytea()` handles both.

import { Buffer } from "node:buffer";

import type { SupabaseClient } from "@supabase/supabase-js";

import { config } from "@/config";
import { decrypt, encrypt } from "@/security/token-crypto";

import {
  STRAVA_API_BASE,
  STRAVA_API_FETCH_TIMEOUT_MS,
} from "./constants";
import {
  StravaError,
  StravaKeyRotationError,
  StravaRateLimited,
  StravaReauthRequired,
} from "./errors";
import { postStravaOauthForm } from "./http";

// Rate-limit header indices: Strava returns `15min,daily` as a single
// comma-separated value for both X-RateLimit-Limit and X-RateLimit-Usage.
interface RateLimitsSnapshot {
  fifteenMin: { used: number; limit: number } | null;
  daily: { used: number; limit: number } | null;
}

interface TokenRow {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  keyVersion: number;
}

interface RawTokenRow {
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  key_version: number | null;
}

function decodeBytea(value: string | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value;
  // PostgREST returns BYTEA columns as `\x<hex>` strings by default
  // (Postgres hex-encoded byte literal). Handle both that form and bare
  // base64 -- the supabase-js client has historically negotiated either.
  if (value.startsWith("\\x")) {
    return new Uint8Array(Buffer.from(value.slice(2), "hex"));
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

function toByteaHex(bytes: Uint8Array): string {
  // Mirror of strava-tokens.ts. PostgREST expects `\x<hex>` literals for
  // BYTEA values in JSON request bodies; supabase-js JSON.stringifies a
  // bare Uint8Array as `{"0":..,"1":..,...}`, which PostgREST 422s.
  return `\\x${Buffer.from(bytes).toString("hex")}`;
}

function parseRateLimitHeader(headerValue: string | null): {
  fifteenMin: number;
  daily: number;
} | null {
  if (!headerValue) return null;
  const parts = headerValue.split(",").map((s) => Number(s.trim()));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return { fifteenMin: parts[0]!, daily: parts[1]! };
}

function extractRateLimits(response: Response): RateLimitsSnapshot {
  const limit = parseRateLimitHeader(response.headers.get("x-ratelimit-limit"));
  const usage = parseRateLimitHeader(response.headers.get("x-ratelimit-usage"));
  if (!limit || !usage) return { fifteenMin: null, daily: null };
  return {
    fifteenMin: { limit: limit.fifteenMin, used: usage.fifteenMin },
    daily: { limit: limit.daily, used: usage.daily },
  };
}

interface Strava401Body {
  errors?: Array<{
    resource?: string;
    field?: string;
    code?: string;
  }>;
}

// Strava sometimes returns 401 for daily-quota exhaustion rather than auth
// expiry. The body's errors[].field/code disambiguate. If we can't read
// the body, fall through to refresh (the worst case is one wasted refresh
// attempt; the alternative would be to spin in StravaRateLimited until the
// athlete re-authed).
function readsAsRateLimit(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const errors = (body as Strava401Body).errors;
  if (!Array.isArray(errors)) return false;
  return errors.some(
    (e) =>
      (typeof e?.field === "string" && /limit/i.test(e.field)) ||
      (typeof e?.code === "string" && /(exceeded|rate)/i.test(e.code))
  );
}

interface StravaTokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in?: number;
  token_type?: string;
}

export interface StravaClient {
  /**
   * Public snapshot of the most recent rate-limit headers Strava sent.
   * Reset on every fetch. Phase B has no consumer; Phase C2 backfill reads
   * this to decide whether to pause before the next batch.
   */
  readonly rateLimits: RateLimitsSnapshot;

  fetch(path: string, init?: RequestInit): Promise<Response>;

  /**
   * Update strava_tokens.last_used_at = now() for this user. Explicit-only:
   * the client never invokes this on its own (Phase C/D callers invoke
   * once per logical session, not per request, to avoid write
   * amplification during 200-activity backfill).
   */
  touchLastUsed(): Promise<void>;
}

export function createStravaClient(
  userId: string,
  admin: SupabaseClient
): StravaClient {
  // Mutable across the client's lifetime. `rateLimits` is exposed as a
  // public field; `tokenCache` lets us avoid re-reading the row on every
  // fetch within a single client instance's lifetime UNLESS a refresh
  // happens, in which case we re-read from DB to pick up any
  // concurrent-refresh winner's tokens.
  const state: { rateLimits: RateLimitsSnapshot; tokenCache: TokenRow | null } =
    {
      rateLimits: { fifteenMin: null, daily: null },
      tokenCache: null,
    };

  async function loadTokensFromDb(): Promise<TokenRow> {
    // service-role: explicit user filter required
    const { data, error } = await admin
      .from("strava_tokens")
      .select("access_token_enc, refresh_token_enc, expires_at, key_version")
      .eq("user_id", userId)
      .maybeSingle<RawTokenRow>();

    if (error) {
      throw new StravaError(
        "unexpected",
        `Failed to load strava_tokens for user: ${error.message}`
      );
    }
    if (
      !data ||
      data.access_token_enc == null ||
      data.refresh_token_enc == null ||
      data.expires_at == null ||
      data.key_version == null
    ) {
      throw new StravaReauthRequired(
        "No Strava token on file for this user; reconnect required"
      );
    }

    let accessPlain: Uint8Array;
    let refreshPlain: Uint8Array;
    try {
      accessPlain = decrypt(decodeBytea(data.access_token_enc), data.key_version);
      refreshPlain = decrypt(
        decodeBytea(data.refresh_token_enc),
        data.key_version
      );
    } catch (err) {
      // Distinguish "missing key version" (operator dropped a key
      // prematurely) from generic decrypt failure -- the former is
      // actionable via env-var rollback; the latter is data corruption.
      const message = err instanceof Error ? err.message : String(err);
      if (/does not contain key version/.test(message)) {
        throw new StravaKeyRotationError(data.key_version);
      }
      throw new StravaError(
        "unexpected",
        `Failed to decrypt strava_tokens row for user`
      );
    }

    return {
      accessToken: new TextDecoder().decode(accessPlain),
      refreshToken: new TextDecoder().decode(refreshPlain),
      expiresAt: data.expires_at,
      keyVersion: data.key_version,
    };
  }

  async function ensureTokens(forceReload = false): Promise<TokenRow> {
    if (!forceReload && state.tokenCache) return state.tokenCache;
    const fresh = await loadTokensFromDb();
    state.tokenCache = fresh;
    return fresh;
  }

  /**
   * Refresh the token pair. The loser of a concurrent-refresh race
   * picks up the winner's tokens by force-reloading from DB BEFORE
   * calling Strava: if it arrives second, the DB already holds the
   * winner's new refresh_token, so its own /oauth/token POST uses a
   * VALID refresh_token rather than the stale in-memory copy. Without
   * the force-reload the loser sends the original (now-rotated)
   * refresh_token, gets 400 invalid_grant, and incorrectly throws
   * StravaReauthRequired.
   */
  async function refreshTokens(): Promise<TokenRow> {
    // FIX-3 / REL-003 / ADV-002: force a DB re-read at the start of
    // refresh so a concurrent loser uses the winner's already-persisted
    // refresh_token rather than its own (now-invalidated) cached copy.
    const current = await ensureTokens(true);
    const clientId = config.strava.clientId;
    const clientSecret = config.strava.clientSecret;
    if (!clientId || !clientSecret) {
      throw new StravaError(
        "unexpected",
        "Strava client credentials not configured"
      );
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
    });

    const { status, body: parsedBody } = await postStravaOauthForm(body);

    if (status === 401 || status === 400) {
      // Strava signals an invalid refresh_token with 400 + body
      // {"error": "invalid_grant"} OR 401. Both mean re-auth required.
      throw new StravaReauthRequired();
    }

    const parsed = parsedBody as StravaTokenRefreshResponse | null;
    if (
      !parsed ||
      !parsed.access_token ||
      !parsed.refresh_token ||
      !parsed.expires_at
    ) {
      throw new StravaError(
        "unexpected",
        "Strava /oauth/token response missing required fields"
      );
    }

    // Encrypt BOTH new tokens (Strava rotates the refresh_token on every
    // refresh). The same key_version applies to both. Persist atomically
    // in a single UPDATE so a partial write cannot leave us with mismatched
    // (access, refresh) pairs.
    const encAccess = encrypt(new TextEncoder().encode(parsed.access_token));
    const encRefresh = encrypt(new TextEncoder().encode(parsed.refresh_token));
    const expiresAtIso = new Date(parsed.expires_at * 1000).toISOString();

    // service-role: explicit user filter required
    const { error: updateErr } = await admin
      .from("strava_tokens")
      .update({
        // BYTEA columns need the `\x<hex>` PostgREST wire format -- a
        // bare Uint8Array serialises as JSON object and 422s.
        access_token_enc: toByteaHex(encAccess.ciphertext),
        refresh_token_enc: toByteaHex(encRefresh.ciphertext),
        expires_at: expiresAtIso,
        key_version: encAccess.keyVersion,
      })
      .eq("user_id", userId);

    if (updateErr) {
      throw new StravaError(
        "unexpected",
        `Failed to persist refreshed Strava tokens: ${updateErr.message}`
      );
    }

    // Re-read from DB so the concurrent-refresh loser picks up the winner's
    // values rather than reusing its own (Strava-invalidated) in-memory copy.
    state.tokenCache = null;
    return await ensureTokens(true);
  }

  async function fetchOnce(
    path: string,
    init: RequestInit,
    tokens: TokenRow
  ): Promise<Response> {
    const url = `${STRAVA_API_BASE}${path}`;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${tokens.accessToken}`);
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers,
        // Phase C/D backfill steps wrap this in step.run() with their
        // own retry. We still want a per-request deadline so a stuck
        // connection doesn't burn the Inngest step's full timeout.
        signal: AbortSignal.timeout(STRAVA_API_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      throw new StravaError(
        "network",
        `Strava ${path} unreachable: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    state.rateLimits = extractRateLimits(response);
    return response;
  }

  async function fetchWithRefresh(
    path: string,
    init: RequestInit
  ): Promise<Response> {
    const tokens = await ensureTokens();
    const first = await fetchOnce(path, init, tokens);

    if (first.status !== 401) return first;

    // Body inspection. `response.clone()` because the caller still gets
    // the first response if we decide not to refresh.
    let body: unknown = undefined;
    try {
      body = await first.clone().json();
    } catch {
      // Body wasn't JSON -- proceed to refresh (worst case: one wasted
      // refresh that returns 401 and surfaces as StravaReauthRequired).
    }

    if (readsAsRateLimit(body)) {
      throw new StravaRateLimited(
        "Strava returned 401 with rate-limit body (daily quota exhausted)"
      );
    }

    const refreshed = await refreshTokens();
    // Retry once with the freshly-read tokens. A second 401 here means
    // the refresh succeeded but the access_token is still being rejected
    // -- usually the athlete revoked from Strava's side mid-flight.
    // The plan mandates throwing StravaReauthRequired (typed) rather
    // than handing back an opaque 401 Response so Inngest callers can
    // class-switch on the error type without status-code introspection.
    const retried = await fetchOnce(path, init, refreshed);
    if (retried.status === 401) {
      throw new StravaReauthRequired(
        "Strava returned 401 after a successful token refresh; user may have revoked"
      );
    }
    return retried;
  }

  return {
    get rateLimits(): RateLimitsSnapshot {
      return state.rateLimits;
    },
    async fetch(path: string, init: RequestInit = {}): Promise<Response> {
      return await fetchWithRefresh(path, init);
    },
    async touchLastUsed(): Promise<void> {
      // service-role: explicit user filter required
      const { error } = await admin
        .from("strava_tokens")
        .update({ last_used_at: new Date().toISOString() })
        .eq("user_id", userId);
      if (error) {
        throw new StravaError(
          "unexpected",
          `Failed to UPDATE strava_tokens.last_used_at: ${error.message}`
        );
      }
    },
  };
}
