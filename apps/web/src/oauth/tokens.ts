import "server-only";

// Issued-token store: opaque access + refresh tokens persisted only as SHA-256
// hashes, with a family_id lineage so a replayed (already-rotated) refresh token
// is detectable as theft and burns the whole family.
//
// All writes via the service-role admin client (oauth_access_tokens has RLS
// enabled with only a self-SELECT policy — the athlete can list/revoke their own
// sessions; the AS owns all writes).

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { generateOpaqueToken, hashToken } from "./crypto";

export const ACCESS_TTL_SECONDS = 60 * 60; // 1 hour
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access token, seconds
}

export interface TokenContext {
  clientId: string;
  userId: string;
  scope: string | null;
  resource: string;
}

/** Mint and persist a new access+refresh pair. `familyId` is reused on rotation. */
export async function issueTokens(
  admin: SupabaseClient,
  ctx: TokenContext,
  familyId: string = randomUUID()
): Promise<IssuedTokens> {
  const accessToken = generateOpaqueToken();
  const refreshToken = generateOpaqueToken();
  const now = Date.now();
  // service-role: token issuance is server-owned; user_id comes from the code/rotation, never a client.
  const { error } = await admin.from("oauth_access_tokens").insert({
    access_token_hash: hashToken(accessToken),
    refresh_token_hash: hashToken(refreshToken),
    client_id: ctx.clientId,
    user_id: ctx.userId,
    family_id: familyId,
    scope: ctx.scope,
    resource: ctx.resource,
    expires_at: new Date(now + ACCESS_TTL_SECONDS * 1000).toISOString(),
    refresh_expires_at: new Date(now + REFRESH_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) throw new Error(`token persist failed: ${error.message}`);
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS };
}

export interface VerifiedAccess {
  userId: string;
  clientId: string;
  scope: string | null;
  resource: string;
}

/** Resolve a presented access token to its (unrevoked, unexpired) row, or null. */
export async function verifyAccessToken(
  admin: SupabaseClient,
  accessToken: string
): Promise<VerifiedAccess | null> {
  const nowIso = new Date().toISOString();
  // service-role: lookup keyed by the unguessable token hash.
  const { data } = await admin
    .from("oauth_access_tokens")
    .select("user_id, client_id, scope, resource")
    .eq("access_token_hash", hashToken(accessToken))
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (!data) return null;
  return {
    userId: data.user_id as string,
    clientId: data.client_id as string,
    scope: (data.scope as string | null) ?? null,
    resource: data.resource as string,
  };
}

export type RotateResult =
  | { result: "ok"; tokens: IssuedTokens }
  | { result: "reuse" }
  | { result: "invalid" };

/**
 * Rotate a refresh token. Single-use is enforced ATOMICALLY: one conditional
 * UPDATE flips revoked_at, so only the first of N concurrent presentations of
 * the same token wins the row (a read-then-update would let two interleaved
 * callers both pass the revoked check and mint two families — a theft bypass).
 * A token presented after it was already rotated is theft: the whole family is
 * revoked and the caller gets `reuse`. When `clientId` is provided it is bound
 * into the claim, so a token cannot be rotated by a different client.
 */
export async function rotateRefresh(
  admin: SupabaseClient,
  refreshToken: string,
  clientId?: string
): Promise<RotateResult> {
  const hash = hashToken(refreshToken);
  const nowIso = new Date().toISOString();

  // service-role: atomic claim keyed by the unguessable refresh-token hash.
  let claim = admin
    .from("oauth_access_tokens")
    .update({ revoked_at: nowIso })
    .eq("refresh_token_hash", hash)
    .is("revoked_at", null)
    .gt("refresh_expires_at", nowIso);
  if (clientId) claim = claim.eq("client_id", clientId);
  const { data: claimed } = await claim
    .select("family_id, client_id, user_id, scope, resource")
    .maybeSingle();

  if (claimed) {
    const tokens = await issueTokens(
      admin,
      {
        clientId: claimed.client_id as string,
        userId: claimed.user_id as string,
        scope: (claimed.scope as string | null) ?? null,
        resource: claimed.resource as string,
      },
      claimed.family_id as string
    );
    return { result: "ok", tokens };
  }

  // Claim missed: disambiguate already-revoked (reuse -> burn family) from
  // expired/unknown (invalid).
  const { data: row } = await admin
    .from("oauth_access_tokens")
    .select("family_id, revoked_at")
    .eq("refresh_token_hash", hash)
    .maybeSingle();
  if (row?.revoked_at) {
    await revokeFamily(admin, row.family_id as string);
    return { result: "reuse" };
  }
  return { result: "invalid" };
}

/** Revoke every live token in a family (theft response). */
export async function revokeFamily(admin: SupabaseClient, familyId: string): Promise<void> {
  await admin
    .from("oauth_access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("family_id", familyId)
    .is("revoked_at", null);
}

/** Disconnect: revoke every live token for a user. */
export async function revokeAllForUser(admin: SupabaseClient, userId: string): Promise<void> {
  // service-role: explicit user filter.
  await admin
    .from("oauth_access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null);
}
