import "server-only";

// Authorization-code storage (single-use, short-TTL, PKCE-bound).
//
// Codes are created at /authorize after consent and redeemed once at /token.
// Stored only as SHA-256 hashes; the plaintext lives only in the redirect. All
// writes via the service-role admin client (oauth_authorization_codes has RLS
// enabled with no policies).

import type { SupabaseClient } from "@supabase/supabase-js";

import { generateOpaqueToken, hashToken } from "./crypto";

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface AuthCodeRecord {
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  scope: string | null;
}

/** Create a single-use code; returns the plaintext code (returned in the redirect). */
export async function createAuthCode(
  admin: SupabaseClient,
  rec: AuthCodeRecord
): Promise<string> {
  const code = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  // service-role: insert is server-owned; user_id is taken from the consented session.
  const { error } = await admin.from("oauth_authorization_codes").insert({
    code_hash: hashToken(code),
    client_id: rec.client_id,
    user_id: rec.user_id,
    redirect_uri: rec.redirect_uri,
    code_challenge: rec.code_challenge,
    resource: rec.resource,
    scope: rec.scope,
    expires_at: expiresAt,
  });
  if (error) throw new Error(`auth code persist failed: ${error.message}`);
  return code;
}

/**
 * Atomically consume a code: the UPDATE ... WHERE consumed_at IS NULL RETURNING
 * makes redemption single-use even under a concurrent replay — only the first
 * caller gets a row back. Returns null when the code is unknown, already used,
 * or expired.
 */
export async function consumeAuthCode(
  admin: SupabaseClient,
  code: string
): Promise<AuthCodeRecord | null> {
  const nowIso = new Date().toISOString();
  // service-role: code lookup is keyed by the opaque code hash (unguessable).
  const { data, error } = await admin
    .from("oauth_authorization_codes")
    .update({ consumed_at: nowIso })
    .eq("code_hash", hashToken(code))
    .is("consumed_at", null)
    .gt("expires_at", nowIso)
    .select("client_id, user_id, redirect_uri, code_challenge, resource, scope")
    .maybeSingle();
  if (error || !data) return null;
  return data as AuthCodeRecord;
}
