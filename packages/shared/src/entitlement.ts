// Mirror of public.entitlements from supabase/migrations/0001_users_and_entitlements.sql.
// Row contract for entitlement state; the table is written only by the
// RevenueCat webhook (service-role path) and read by the user themselves
// (RLS self-select).
//
// Primary key is composite: (user_id, entitlement_key). Upserts use that
// pair as the conflict target.

import { z } from "zod";

// Matches the SQL CHECK constraint: source IN ('revenuecat'). Extend the
// enum if a second source ever lands -- and update the migration's CHECK
// in the same PR.
export const EntitlementSourceSchema = z.enum(["revenuecat"]);
export type EntitlementSource = z.infer<typeof EntitlementSourceSchema>;

// Known paid-feature entitlement keys. The column stays open-ended TEXT in
// SQL (the RevenueCat product mapping can introduce new keys without a
// migration), so `EntitlementRowSchema.entitlement_key` is left as a bare
// string. This enum pins the *application-recognised* vocabulary that gates
// check against (see `requireEntitlement`/`hasActiveEntitlement` in
// apps/web/src/auth/entitlements.ts), so a typo in a gate is a compile error.
//
// Keys named by the AI core plan:
//   - "ai_plans"      AI plan generation + adaptive re-plan engine (paid).
//   - "trend_reports" athlete trend / progress reports (paid).
//   - "coach_invite"  coach-athlete linking / invites (paid).
export const EntitlementKeySchema = z.enum([
  "ai_plans",
  "trend_reports",
  "coach_invite",
]);
export type EntitlementKey = z.infer<typeof EntitlementKeySchema>;

// entitlement_key is open-ended TEXT in SQL. The RevenueCat product mapping
// defines the wire vocabulary, so the row schema accepts any string; the
// closed `EntitlementKeySchema` above pins the keys the app gates on.
export const EntitlementRowSchema = z.object({
  user_id: z.string().uuid(),
  entitlement_key: z.string(),
  active: z.boolean(),
  source: EntitlementSourceSchema,
  expires_at: z.string().datetime({ offset: true }).nullable(),
  updated_at: z.string().datetime({ offset: true }),
});

export type EntitlementRow = z.infer<typeof EntitlementRowSchema>;
