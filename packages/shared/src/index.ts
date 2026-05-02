// Cross-app type contracts. Schemas here mirror Pydantic models in apps/api/src/schemas/.
// Phase B onwards generates these from Pydantic via apps/api/scripts/generate_shared_schemas.py.

import { z } from "zod";

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
  display_name: z.string().nullable(),
  role_flags: z.array(z.enum(["athlete", "coach"])),
  timezone: z.string(),
  created_at: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const EntitlementKeySchema = z.enum(["ai_plans", "trend_reports", "coach_invite"]);
export type EntitlementKey = z.infer<typeof EntitlementKeySchema>;

export const EntitlementSchema = z.object({
  entitlement_key: EntitlementKeySchema,
  active: z.boolean(),
  expires_at: z.string().nullable(),
});
export type Entitlement = z.infer<typeof EntitlementSchema>;
