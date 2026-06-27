import "server-only";

// Dynamic Client Registration (RFC 7591) storage + redirect-URI validation.
//
// Clients are global (Claude registering itself), not user-scoped. All writes go
// through the service-role admin client; oauth_clients has RLS enabled with no
// policies, so it is unreachable under a user JWT.

import type { SupabaseClient } from "@supabase/supabase-js";

import { generateOpaqueToken } from "./crypto";

export interface OAuthClient {
  client_id: string;
  redirect_uris: string[];
  client_name: string | null;
}

// Personal-use guards on an otherwise-open DCR endpoint (storage-DoS defense).
const MAX_CLIENTS_TOTAL = 1_000;
const MAX_CLIENTS_PER_IP_PER_HOUR = 5;

/**
 * A redirect URI is allowed only when it is an exact, fragment-less URL that is
 * either HTTPS (any public host — Claude's hosted callback) or HTTP on a
 * loopback host (Claude Code's local callback, any port). Everything else —
 * custom schemes, non-loopback HTTP, URLs with a fragment — is rejected.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false; // RFC 6749: redirect URIs must not carry a fragment
  if (u.protocol === "https:") return u.hostname.length > 0;
  if (u.protocol === "http:") {
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  }
  return false;
}

export class RegistrationError extends Error {
  constructor(
    public code: "invalid_redirect_uri" | "rate_limited" | "capacity",
    message: string
  ) {
    super(message);
  }
}

export async function registerClient(
  admin: SupabaseClient,
  input: { redirectUris: string[]; clientName?: string; ip?: string }
): Promise<OAuthClient> {
  if (input.redirectUris.length === 0) {
    throw new RegistrationError("invalid_redirect_uri", "at least one redirect_uri required");
  }
  for (const uri of input.redirectUris) {
    if (!isAllowedRedirectUri(uri)) {
      throw new RegistrationError(
        "invalid_redirect_uri",
        `redirect_uri not allowed: must be https or http loopback, no fragment`
      );
    }
  }

  // service-role: explicit guards below; oauth_clients is global (no user scope).
  const { count: total } = await admin
    .from("oauth_clients")
    .select("*", { count: "exact", head: true });
  if ((total ?? 0) >= MAX_CLIENTS_TOTAL) {
    throw new RegistrationError("capacity", "client registration capacity reached");
  }

  if (input.ip) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: perIp } = await admin
      .from("oauth_clients")
      .select("*", { count: "exact", head: true })
      .eq("registered_ip", input.ip)
      .gte("created_at", since);
    if ((perIp ?? 0) >= MAX_CLIENTS_PER_IP_PER_HOUR) {
      throw new RegistrationError("rate_limited", "too many registrations from this client");
    }
  }

  const clientId = `mcp_${generateOpaqueToken()}`;
  const { data, error } = await admin
    .from("oauth_clients")
    .insert({
      client_id: clientId,
      redirect_uris: input.redirectUris,
      client_name: input.clientName ?? null,
      registered_ip: input.ip ?? null,
    })
    .select("client_id, redirect_uris, client_name")
    .single();
  if (error || !data) {
    throw new Error(`client registration failed: ${error?.message ?? "no row"}`);
  }
  return data as OAuthClient;
}

export async function getClient(
  admin: SupabaseClient,
  clientId: string
): Promise<OAuthClient | null> {
  // service-role: client lookup by id (global resource, no user scope).
  const { data } = await admin
    .from("oauth_clients")
    .select("client_id, redirect_uris, client_name")
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as OAuthClient | null) ?? null;
}
