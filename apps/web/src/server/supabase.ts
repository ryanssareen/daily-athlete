/**
 * Supabase clients (server-only).
 *
 * - createUserScopedClient(jwt): anon key + per-request `Authorization: Bearer <jwt>`.
 *   PostgREST sets `request.jwt.claim.sub` from the token automatically per HTTP
 *   request, so RLS policies see the right user without any manual GUC.
 *   This is the canonical Supabase pattern, verified in Unit-0 preflight.
 *
 * - getServiceClient(): service-role key — bypasses RLS. Reserved for explicitly
 *   privileged work (RevenueCat webhook, cascade routines). Don't import this in
 *   route handlers that touch user-supplied IDs without explicit WHERE filters;
 *   `grep -rn "getServiceClient" apps/web/app` should show a small, auditable
 *   set of call sites.
 *
 * The original draft of this plan tried to set `request.jwt.claim.sub` via
 * `SET LOCAL` against a service-role client. Document-review caught that this
 * is a fatal bug — `supabase-js` makes separate PostgREST HTTP requests, and
 * `SET LOCAL` only persists inside a transaction. The pattern below avoids the
 * issue entirely by passing the JWT through PostgREST.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getConfig } from "@/server/config";

let _serviceClient: SupabaseClient | undefined;

export function getServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;
  const cfg = getConfig();
  if (!cfg.supabaseUrl) {
    throw new Error("SUPABASE_URL must be set to construct the service client");
  }
  if (!cfg.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set to construct the service client");
  }
  _serviceClient = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "da2-web/server-service" } },
  });
  return _serviceClient;
}

/**
 * Build a per-request Supabase client scoped to the authenticated user.
 *
 * Each call returns a fresh client (no caching across requests). Don't store
 * this in module-level state — that would mix users.
 */
export function createUserScopedClient(jwt: string): SupabaseClient {
  const cfg = getConfig();
  if (!cfg.supabaseUrl) {
    throw new Error("SUPABASE_URL must be set to construct a user-scoped client");
  }
  if (!cfg.supabaseAnonKey) {
    throw new Error("SUPABASE_ANON_KEY must be set to construct a user-scoped client");
  }
  return createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
        "X-Client-Info": "da2-web/server-userscoped",
      },
    },
  });
}

/** Test helper. */
export function resetSupabaseClientCache(): void {
  _serviceClient = undefined;
}
