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

// entitlement_key is open-ended TEXT in SQL. v1 has no documented
// vocabulary yet; the RevenueCat product mapping defines it. Pin to a
// closed enum once the set stabilises.
export const EntitlementRowSchema = z.object({
  user_id: z.string().uuid(),
  entitlement_key: z.string(),
  active: z.boolean(),
  source: EntitlementSourceSchema,
  expires_at: z.string().datetime({ offset: true }).nullable(),
  updated_at: z.string().datetime({ offset: true }),
});

export type EntitlementRow = z.infer<typeof EntitlementRowSchema>;
