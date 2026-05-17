// DELETE /api/integrations/strava/disconnect
//
// Disconnects a user's Strava integration:
//   1. Soft-delete the strava_tokens row (set deleted_at = now()).
//   2. Call Strava's POST /oauth/deauthorize server-side (never returns the
//      token to the client).
//   3. If Strava's deauthorize endpoint is unavailable, still soft-delete the
//      local row and log the failure — do not block the user.
//
// Auth: Bearer token (Flutter app) or SSR cookie (web). Handled by resolveAuth().
// Returns: 204 No Content on success.
//
// Logging policy:
//   - Log user_id, success flag, error codes.
//   - NEVER log access_token, refresh_token, or full Strava response bodies.

import { NextResponse } from "next/server";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";

function logEvent(event: {
  name: string;
  user_id?: string;
  success: boolean;
  code?: string;
}): void {
  // eslint-disable-next-line no-console
  console.info(
    `[strava.disconnect] ${event.name}`,
    JSON.stringify({
      user_id: event.user_id,
      success: event.success,
      code: event.code,
    }),
  );
}

// POST is used by HTML forms (method="post"). DELETE is used by API clients
// (Flutter app, direct API calls). Both run identical logic.
export async function POST(request: Request): Promise<NextResponse> {
  return disconnect(request);
}

export async function DELETE(request: Request): Promise<NextResponse> {
  return disconnect(request);
}

async function disconnect(request: Request): Promise<NextResponse> {
  // 1. Authenticate the caller.
  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // 2. Look up the current strava_tokens row to get the access token for
  //    the deauthorize call. We read the raw (encrypted) row; the actual
  //    Strava deauthorize call needs the decrypted token. However, to keep
  //    this route self-contained and avoid duplicating the decrypt path, we
  //    call Strava deauthorize using the token fetched via a dedicated helper.
  //    See note below on deauthorize failure handling.
  //
  // service-role: explicit user filter required
  const { data: tokenRow, error: lookupErr } = await admin
    .from("strava_tokens")
    .select("user_id, access_token_enc, key_version")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle<{
      user_id: string;
      access_token_enc: unknown;
      key_version: number;
    }>();

  if (lookupErr) {
    logEvent({
      name: "token_lookup_failed",
      user_id: user.id,
      success: false,
      code: "internal_error",
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (!tokenRow) {
    logEvent({
      name: "token_not_found",
      user_id: user.id,
      success: false,
      code: "not_found",
    });
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 3. Soft-delete the local row. Per AGENTS.md convention and the plan spec,
  //    we SOFT-DELETE only (set deleted_at = now()); we do NOT hard-delete.
  //    This preserves the audit trail and allows recovery if needed.
  //
  // service-role: explicit user filter required
  const { error: deleteErr } = await admin
    .from("strava_tokens")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("deleted_at", null);

  if (deleteErr) {
    logEvent({
      name: "soft_delete_failed",
      user_id: user.id,
      success: false,
      code: "internal_error",
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // 4. Attempt to notify Strava of the deauthorization. This requires the
  //    plaintext access token. We decrypt it here using the token-crypto module.
  //    Failure to call Strava is logged but does NOT block the 204 response —
  //    the local row is already soft-deleted, which is the authoritative source.
  //
  //    Implementation note: the encrypt/decrypt module lives in @/security/token-crypto.
  //    We import it dynamically to avoid circular-module issues and to be explicit
  //    about the failure mode (log + continue).
  try {
    const { decrypt } = await import("@/security/token-crypto");
    // access_token_enc is stored as a \x<hex> BYTEA string from PostgREST.
    // Convert it back to a Uint8Array for decrypt().
    const encHex = tokenRow.access_token_enc as string;
    const encBytes = hexToUint8Array(encHex);
    const plaintext = decrypt(encBytes, tokenRow.key_version);
    const accessToken = new TextDecoder().decode(plaintext);

    await callStravaDeauthorize(accessToken);
    logEvent({
      name: "strava_deauthorized",
      user_id: user.id,
      success: true,
    });
  } catch (err) {
    // Strava deauthorize failed — log but do NOT block the response.
    // The local strava_tokens row is already soft-deleted.
    logEvent({
      name: "strava_deauthorize_failed",
      user_id: user.id,
      success: false,
      code: err instanceof Error ? err.message : "deauthorize_error",
    });
  }

  logEvent({ name: "disconnected", user_id: user.id, success: true });
  return new NextResponse(null, { status: 204 });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a PostgREST BYTEA hex literal (`\x<hex>`) to a Uint8Array.
 * The leading `\x` prefix is stripped before hex-decoding.
 */
function hexToUint8Array(hexStr: string): Uint8Array {
  // PostgREST returns BYTEA as `\x<hexchars>`. Strip the prefix.
  const clean = hexStr.startsWith("\\x") ? hexStr.slice(2) : hexStr;
  if (clean.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * POSTs to Strava's deauthorize endpoint with the given access token.
 * Throws on network failure or non-2xx response — caller handles.
 */
async function callStravaDeauthorize(accessToken: string): Promise<void> {
  const response = await fetch("https://www.strava.com/oauth/deauthorize", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `access_token=${encodeURIComponent(accessToken)}`,
  });
  if (!response.ok) {
    throw new Error(`Strava deauthorize returned ${response.status}`);
  }
}
