// Mirror of public.users from supabase/migrations/0001_users_and_entitlements.sql.
// Row contract for app code; the row is auto-created by the
// handle_new_auth_user trigger on auth.users INSERT (mirrored from Supabase
// Auth). Email updates propagate via the trigger in 0003_security_hardening.sql.

import { z } from "zod";

// Matches the SQL CHECK: role_flags must be a subset of {athlete, coach}
// AND cardinality must be >= 1. Both is allowed; the user may be coach + athlete.
export const RoleFlagSchema = z.enum(["athlete", "coach"]);
export type RoleFlag = z.infer<typeof RoleFlagSchema>;

export const RoleFlagsSchema = z.array(RoleFlagSchema).min(1);
export type RoleFlags = z.infer<typeof RoleFlagsSchema>;

// Normalized, NON-PII moderation reason code, stored on
// users.disabled_reason_code (0018) and recorded in the admin audit log. The
// operator's free-text reason is NEVER one of these — it goes only into the
// moderation email body. Keep in sync with the disabled_reason_code column.
export const ModerationReasonCodeSchema = z.enum([
  "spam",
  "abuse",
  "tos_violation",
  "fraud",
  "user_request",
  "other",
]);
export type ModerationReasonCode = z.infer<typeof ModerationReasonCodeSchema>;

// email is TEXT nullable in SQL. Apple Hide-My-Email relay addresses
// (xxx@privaterelay.appleid.com) are valid here. Stricter email format
// validation belongs at the API boundary, not the row contract.
//
// Timestamps use `.datetime({ offset: true })` because PostgREST returns
// TIMESTAMPTZ values in offset notation (e.g. "2026-05-13T10:30:00+00:00").
// The default `.datetime()` requires the strict Z suffix and would reject
// real Supabase output.
export const UserRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  display_name: z.string().nullable(),
  role_flags: RoleFlagsSchema,
  timezone: z.string(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  deleted_at: z.string().datetime({ offset: true }).nullable(),
  // Moderation (0018). disabled_at is set when an operator disables the account
  // (login blocked via Auth ban); disabled_reason_code is the normalized,
  // non-PII reason for the disable/delete. Both null for an active account.
  disabled_at: z.string().datetime({ offset: true }).nullable(),
  disabled_reason_code: ModerationReasonCodeSchema.nullable(),
});

export type UserRow = z.infer<typeof UserRowSchema>;
