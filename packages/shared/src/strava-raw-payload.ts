// Mirror of public.strava_raw_payloads from supabase/migrations/0002_strava_infra.sql.
//
// Append-only archive of raw Strava deliveries (webhook events and hydration
// pulls). Retention-bounded (default 30 days) by a scheduled cleanup; see
// apps/web/src/jobs/strava-payload-retention.ts when that lands.
//
// Excluded from supabase_realtime publication (sensitive surface).
// Service-role-only writes; self-only RLS reads.

import { z } from "zod";

// Matches the SQL CHECK: kind IN ('webhook', 'hydration').
// - 'webhook' rows may have user_id NULL initially (the resolver job
//   maps athlete_strava_id -> user_id after the fact).
// - 'hydration' rows MUST have user_id set (CHECK constraint enforces).
export const StravaRawKindSchema = z.enum(["webhook", "hydration"]);
export type StravaRawKind = z.infer<typeof StravaRawKindSchema>;

// payload shape varies per kind AND per Strava API change. Keeping this as
// `unknown` is deliberate -- consumers cast as needed and the typed contract
// for any specific shape belongs in the consumer module, not here.
// The SQL CHECK that ties kind='hydration' to user_id IS NOT NULL is NOT
// enforced by Zod (the row contract represents what comes back, not the
// insert preconditions).
export const StravaRawPayloadRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  kind: StravaRawKindSchema,
  payload: z.unknown(),
  arrived_at: z.string().datetime({ offset: true }),
});

export type StravaRawPayloadRow = z.infer<typeof StravaRawPayloadRowSchema>;
