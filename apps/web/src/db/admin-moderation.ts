import "server-only";

// Admin user moderation state transitions. A deliberate RLS-bypass exception
// (service-role) — callers MUST gate on the admin session before invoking.
//
// Login enforcement is a Supabase Auth ban (auth.admin.updateUserById
// ban_duration): a far-future duration blocks sign-in + token refresh, "none"
// lifts it. The public.users columns (disabled_at / deleted_at /
// disabled_reason_code) are the app-visible mirror for the directory + restore.
//
// Contract:
// - Expected, recoverable states return a discriminated ModerationResult
//   ("not_found" | "conflict") so the route can map them to 404 / 409.
// - Unexpected infra failures (DB / Auth API errors) THROW, so the route
//   returns 500 rather than reporting a half-applied success. Order is DB
//   update first, then the ban toggle — both must succeed.
// - Every query carries an explicit user_id filter per AGENTS.md.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ModerationReasonCode } from "@da2/shared";

import { createAdminClient } from "@/db/admin";

export const MODERATION_GRACE_DAYS = 30;

// GoTrue ban durations. ~100 years effectively = permanent until lifted.
const BAN_DURATION = "876000h";
const UNBAN = "none";

export type ModerationResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "conflict" };

interface ModeratableRow {
  id: string;
  deleted_at: string | null;
  disabled_at: string | null;
}

/** When a soft-deleted account becomes eligible for permanent purge (sweeper). */
export function purgeEligibleAt(deletedAt: string | Date): Date {
  const base = typeof deletedAt === "string" ? new Date(deletedAt) : deletedAt;
  return new Date(base.getTime() + MODERATION_GRACE_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * The user's email for sending a moderation notice. Service-role read; the
 * caller passes the address straight to the email layer and NEVER into the
 * audit log (which stays non-PII).
 */
export async function getUserEmail(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  // service-role: explicit user filter required (recipient lookup).
  const { data } = await admin
    .from("users")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  return (data?.email as string | null | undefined) ?? null;
}

async function fetchRow(
  admin: SupabaseClient,
  userId: string
): Promise<ModeratableRow | null> {
  // service-role: explicit user filter required (admin moderation read).
  const { data } = await admin
    .from("users")
    .select("id, deleted_at, disabled_at")
    .eq("id", userId)
    .maybeSingle();
  return (data as ModeratableRow | null) ?? null;
}

async function setBan(
  admin: SupabaseClient,
  userId: string,
  banDuration: string
): Promise<void> {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: banDuration,
  });
  if (error) {
    throw new Error(`auth ban toggle failed: ${error.message}`);
  }
}

/** Disable an active account: block login + stamp disabled_at + reason code. */
export async function disableUser(
  userId: string,
  reasonCode: ModerationReasonCode
): Promise<ModerationResult> {
  const admin = createAdminClient();
  const row = await fetchRow(admin, userId);
  if (!row) return { ok: false, error: "not_found" };
  if (row.deleted_at) return { ok: false, error: "conflict" }; // restore first
  if (row.disabled_at) return { ok: false, error: "conflict" }; // already disabled

  // service-role: explicit user filter required (admin moderation write).
  const { error } = await admin
    .from("users")
    .update({
      disabled_at: new Date().toISOString(),
      disabled_reason_code: reasonCode,
    })
    .eq("id", userId);
  if (error) throw new Error(`disableUser update failed: ${error.message}`);

  await setBan(admin, userId, BAN_DURATION);
  return { ok: true };
}

/** Re-enable a disabled account: lift the ban + clear disabled state. */
export async function enableUser(userId: string): Promise<ModerationResult> {
  const admin = createAdminClient();
  const row = await fetchRow(admin, userId);
  if (!row) return { ok: false, error: "not_found" };
  if (row.deleted_at) return { ok: false, error: "conflict" }; // deleted, not disabled
  if (!row.disabled_at) return { ok: false, error: "conflict" }; // not disabled

  // service-role: explicit user filter required (admin moderation write).
  const { error } = await admin
    .from("users")
    .update({ disabled_at: null, disabled_reason_code: null })
    .eq("id", userId);
  if (error) throw new Error(`enableUser update failed: ${error.message}`);

  await setBan(admin, userId, UNBAN);
  return { ok: true };
}

/** Soft-delete: tombstone (deleted_at) + block login. Reversible within grace. */
export async function softDeleteUser(
  userId: string,
  reasonCode: ModerationReasonCode
): Promise<ModerationResult> {
  const admin = createAdminClient();
  const row = await fetchRow(admin, userId);
  if (!row) return { ok: false, error: "not_found" };
  if (row.deleted_at) return { ok: false, error: "conflict" }; // already deleted

  // service-role: explicit user filter required (admin moderation write).
  const { error } = await admin
    .from("users")
    .update({
      deleted_at: new Date().toISOString(),
      disabled_reason_code: reasonCode,
    })
    .eq("id", userId);
  if (error) throw new Error(`softDeleteUser update failed: ${error.message}`);

  await setBan(admin, userId, BAN_DURATION);
  return { ok: true };
}

/** Restore a soft-deleted account to active — only within the grace window. */
export async function restoreUser(userId: string): Promise<ModerationResult> {
  const admin = createAdminClient();
  const row = await fetchRow(admin, userId);
  if (!row) return { ok: false, error: "not_found" };
  if (!row.deleted_at) return { ok: false, error: "conflict" }; // not deleted
  if (Date.now() >= purgeEligibleAt(row.deleted_at).getTime()) {
    return { ok: false, error: "conflict" }; // grace window elapsed
  }

  // service-role: explicit user filter required (admin moderation write).
  const { error } = await admin
    .from("users")
    .update({ deleted_at: null, disabled_at: null, disabled_reason_code: null })
    .eq("id", userId);
  if (error) throw new Error(`restoreUser update failed: ${error.message}`);

  await setBan(admin, userId, UNBAN);
  return { ok: true };
}
