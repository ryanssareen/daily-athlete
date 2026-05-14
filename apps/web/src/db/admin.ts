// Service-role supabase-js admin client factory. Use ONLY for paths that
// must bypass RLS (e.g. strava_tokens writes, Inngest functions doing
// cross-user work).
//
// SECURITY: The service-role key bypasses all RLS. Code that takes an
// admin client MUST explicitly filter by user_id on every read/write and
// document the filter with a comment:
//   // service-role: explicit user filter required
// AGENTS.md "Secrets" + the existing 0002_strava_infra.sql comment block
// codify this contract.
//
// We construct a fresh client per request rather than caching a module-
// scoped singleton: Next.js Route Handlers run on a per-request basis and
// any "module scope" caching would be per-warm-Lambda only, while still
// holding the service-role JWT across unrelated requests. Cheap to
// construct; the JWT is just a string.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { config } from "@/config";

export function createAdminClient(): SupabaseClient {
  const url = config.supabase.url;
  const serviceRoleKey = config.supabase.serviceRoleKey;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase URL or service-role key not configured. " +
        "These are required for service-role operations."
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
