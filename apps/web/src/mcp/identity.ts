import "server-only";

// The MCP auth bridge. Two responsibilities:
//
//  1. verifyToken(): the `withMcpAuth` callback. Resolves a presented bearer to
//     a Daily-Athlete user, then gates on account state. Because this path mints
//     its own JWT and never calls GoTrue, a Supabase Auth ban is bypassed — so
//     the users.deleted_at / disabled_at column read here is the AUTHORITATIVE
//     gate (not a mirror). Every disable/delete path must set those columns.
//
//  2. rlsClientForUser(): mint a short-lived Supabase JWT for the user and build
//     a per-request supabase-js client that carries it, so `auth.uid()` resolves
//     and RLS scopes every tool query. This is the ONLY way tools touch the DB —
//     never the service-role admin client (R5).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicOrigin } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import { config } from "@/config";
import { createAdminClient } from "@/db/admin";

import { mintSupabaseJwt } from "@/oauth/crypto";
import { verifyAccessToken } from "@/oauth/tokens";

/** This server's canonical MCP resource identifier (RFC 8707 audience). */
export function canonicalResource(req: Request): string {
  return `${getPublicOrigin(req).replace(/\/+$/, "")}/api/mcp`;
}
function normalizeResource(r: string): string {
  return r.replace(/\/+$/, "");
}

export interface McpIdentity {
  userId: string;
  resource: string;
}

/** Pull our identity out of the AuthInfo `extra` bag set by verifyToken. */
export function identityFromAuth(authInfo: AuthInfo | undefined): McpIdentity {
  const extra = authInfo?.extra as Partial<McpIdentity> | undefined;
  if (!extra?.userId || !extra?.resource) {
    throw new Error("mcp tool invoked without a resolved identity");
  }
  return { userId: extra.userId, resource: extra.resource };
}

/**
 * Build an RLS-bound Supabase client acting as `userId`. The minted JWT is tiny
 * (≤60s) and exists only for this request. We attach it via a global
 * Authorization header rather than setSession (which would try to refresh it
 * against GoTrue, which never issued it).
 */
export function rlsClientForUser(userId: string): SupabaseClient {
  const url = config.supabase.url;
  const anonKey = config.supabase.anonKey;
  const secret = config.mcpOAuth.supabaseJwtSecret;
  if (!url || !anonKey || !secret) {
    throw new Error("MCP RLS bridge missing supabase url/anon key/jwt secret");
  }
  const jwt = mintSupabaseJwt({ userId, secret, supabaseUrl: url });
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function rlsClientFromAuth(authInfo: AuthInfo | undefined): {
  supabase: SupabaseClient;
  identity: McpIdentity;
} {
  const identity = identityFromAuth(authInfo);
  return { supabase: rlsClientForUser(identity.userId), identity };
}

/** `withMcpAuth` verifyToken: bearer -> user -> account-state gate -> AuthInfo. */
export async function verifyToken(
  req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const admin = createAdminClient();

  const verified = await verifyAccessToken(admin, bearerToken);
  if (!verified) return undefined;

  // RFC 8707 audience enforcement: the token must have been issued for THIS
  // resource. Prevents a token minted for another audience being replayed here.
  if (normalizeResource(verified.resource) !== normalizeResource(canonicalResource(req))) {
    return undefined;
  }

  // Authoritative account-state gate (we bypass GoTrue, so the ban can't help us).
  // service-role: explicit user filter.
  const { data: userRow } = await admin
    .from("users")
    .select("deleted_at, disabled_at")
    .eq("id", verified.userId)
    .maybeSingle();
  if (!userRow || userRow.deleted_at || userRow.disabled_at) return undefined;

  return {
    token: bearerToken,
    clientId: verified.clientId,
    scopes: verified.scope ? verified.scope.split(" ").filter(Boolean) : [],
    extra: { userId: verified.userId, resource: verified.resource },
  };
}
