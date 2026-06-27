import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BackfillStatusColumn } from "@da2/shared";

/**
 * Full-object replace of athlete_profiles.backfill_status for a single user.
 *
 * Always a full replace (no partial merge) so the column stays consistent
 * with the CHECK constraint and the Zod schema shape.
 *
 * Uses UPSERT (not a bare UPDATE) on purpose: a plain
 * `UPDATE ... WHERE user_id = $1` against a non-existent athlete_profiles
 * row affects ZERO rows and returns NO error — a silent no-op. That was the
 * failure mode behind a backfill that "sticks at 0 forever": the poller
 * reads back `{}` because the status write never landed. Upserting on
 * user_id guarantees the row exists and the status is persisted. All other
 * athlete_profiles columns carry NOT NULL DEFAULTs (see migration 0004), so
 * an insert with just (user_id, backfill_status) is well-formed; on conflict
 * only backfill_status is overwritten, leaving manual_fields/baselines intact.
 *
 * // service-role: explicit user filter required
 */
export async function updateBackfillStatus(
  admin: SupabaseClient,
  userId: string,
  status: BackfillStatusColumn
): Promise<void> {
  // service-role: explicit user filter required
  const { error } = await admin
    .from("athlete_profiles")
    .upsert(
      { user_id: userId, backfill_status: status },
      { onConflict: "user_id" }
    );

  if (error) {
    throw new Error(
      `updateBackfillStatus failed for user ${userId}: ${error.message}`
    );
  }
}
