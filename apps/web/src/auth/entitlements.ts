import "server-only";

// Canonical paid-feature entitlement check.
//
// `hasActiveEntitlement` answers "does this user currently hold an active,
// unexpired entitlement for `key`?". `requireEntitlement` is the thin route
// wrapper that turns a miss into a 402 NextResponse so the handler can
// `const gate = await requireEntitlement(...); if (gate) return gate;` and
// otherwise proceed.
//
// Two call sites in the AI adaptive-plans engine use these:
//   1. Trigger enqueue / generation — don't spend an LLM call for a free user.
//   2. Apply — re-check at accept time (entitlement may have lapsed while a
//      proposal was pending).
//
// Client flexibility (this is the key design point): the same query runs
// correctly under BOTH supabase clients.
//   - User-JWT client (`@/auth/server`): the `entitlements_self_select` RLS
//     policy (auth.uid() = user_id) already scopes reads to the caller. The
//     explicit user_id filter is redundant-but-harmless there.
//   - Service-role admin client (`@/db/admin`): RLS is bypassed, so the
//     explicit user_id filter IS the security boundary. Used by cron /
//     Inngest contexts that act on a user's behalf.
// Passing the userId explicitly (rather than relying on the JWT) keeps a
// single implementation valid in both contexts.

import { NextResponse } from "next/server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EntitlementKey } from "@da2/shared";

/**
 * True iff `userId` holds an active, non-expired entitlement for `key`.
 *
 * Mirrors public.entitlements semantics from
 * supabase/migrations/0001_users_and_entitlements.sql:
 *   active = true AND (expires_at IS NULL OR expires_at > now()).
 *
 * `now()` is evaluated on the DB server (a SQL filter), not the app clock,
 * so it is consistent with the RevenueCat-written `expires_at` values.
 *
 * Works under a user-JWT client (RLS self-select permits the read) and under
 * a service-role admin client (the explicit user_id filter below is the
 * security boundary). A query error is treated as "not entitled" (fail
 * closed) and logged — a paid gate must never fail open.
 */
export async function hasActiveEntitlement(
  client: SupabaseClient,
  userId: string,
  key: EntitlementKey
): Promise<boolean> {
  const nowIso = new Date().toISOString();

  // service-role: explicit user filter required
  const { data, error } = await client
    .from("entitlements")
    .select("user_id")
    .eq("user_id", userId)
    .eq("entitlement_key", key)
    .eq("active", true)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .limit(1)
    .maybeSingle();

  if (error) {
    // Fail closed: a read error must not grant access.
    console.error(
      "[entitlements] hasActiveEntitlement query failed",
      JSON.stringify({ user_id: userId, entitlement_key: key, code: error.code })
    );
    return false;
  }

  return data !== null;
}

/**
 * Route guard: returns a 402 `NextResponse` when `userId` lacks an active
 * entitlement for `key`, otherwise `null` so the caller proceeds.
 *
 * Usage in a route handler:
 *   const gate = await requireEntitlement(supabase, user.id, "ai_plans");
 *   if (gate) return gate; // 402 — free user
 *   // ...entitled; continue
 *
 * 402 Payment Required is the canonical "this is a paid feature" signal; the
 * body shape (`{ error, entitlement_key }`) matches the repo's
 * `NextResponse.json({ error }, { status })` error convention.
 */
export async function requireEntitlement(
  client: SupabaseClient,
  userId: string,
  key: EntitlementKey
): Promise<NextResponse | null> {
  const entitled = await hasActiveEntitlement(client, userId, key);
  if (entitled) return null;

  return NextResponse.json(
    { error: "payment_required", entitlement_key: key },
    { status: 402 }
  );
}
