import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BackfillStatusColumn } from "@da2/shared";

/**
 * Full-object replace of athlete_profiles.backfill_status for a single user.
 *
 * Always a full replace (no partial merge) so the column stays consistent
 * with the CHECK constraint and the Zod schema shape.
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
    .update({ backfill_status: status })
    .eq("user_id", userId);

  if (error) {
    throw new Error(
      `updateBackfillStatus failed for user ${userId}: ${error.message}`
    );
  }
}
