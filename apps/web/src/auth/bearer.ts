// Bearer-token-aware Supabase auth resolution for App Router route
// handlers.
//
// Mobile clients post `Authorization: Bearer <jwt>` (the Supabase
// access_token); the cookie jar is not shared with `da2://`. The default
// `supabase.auth.getUser()` call reads from cookies only -- a mobile
// request with no cookies but a valid Bearer token would 401, breaking
// agent / device flows.
//
// This helper:
//   1. Extracts a Bearer token from the Authorization header (if any).
//   2. Passes it to `supabase.auth.getUser(token)` -- supabase-js falls
//      back to its internal cookie-derived session when `token` is
//      undefined, so the cookie path still works for browser callers.
//
// Used by every Strava OAuth-flow route. Other routes that accept both
// callers should adopt this same pattern.

import type { SupabaseClient, User } from "@supabase/supabase-js";

interface ResolvedAuth {
  user: User | null;
  error: unknown;
}

function extractBearer(request: Request): string | undefined {
  const header = request.headers.get("Authorization");
  if (!header) return undefined;
  // Per RFC 6750 the scheme matches case-insensitively.
  if (!header.toLowerCase().startsWith("bearer ")) return undefined;
  return header.slice("bearer ".length).trim() || undefined;
}

/**
 * Resolve the authenticated user from either a Bearer token (mobile) or
 * the SSR cookie session (browser). Always returns the same shape so
 * the route handler can `if (!user) return errorJson('unauthorized', 401)`
 * uniformly.
 */
export async function resolveAuth(
  supabase: SupabaseClient,
  request: Request
): Promise<ResolvedAuth> {
  const bearerToken = extractBearer(request);
  const { data, error } = await supabase.auth.getUser(bearerToken);
  return { user: data.user ?? null, error };
}
