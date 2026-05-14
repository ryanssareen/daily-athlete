// Service-role DB helpers for the public.strava_tokens table.
//
// strava_tokens has no INSERT/UPDATE RLS policy -- writes here are
// service-role only (AGENTS.md "Secrets"). Every function below carries
// an explicit:
//   // service-role: explicit user filter required
// next to the supabase-js call. Callers in route handlers MUST first
// confirm `auth.uid()` via the JWT-bound client; this module trusts the
// caller and writes by user_id without re-checking.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface StravaTokenWrite {
  user_id: string;
  access_token_enc: Uint8Array;
  refresh_token_enc: Uint8Array;
  expires_at: string;
  scope: string;
  athlete_strava_id: number;
  key_version: number;
}

export interface StravaTokenOwnershipCheck {
  user_id: string;
}

/**
 * Returns the user_id currently linked to this athlete_strava_id, or
 * null if no row exists. Used by the connect route to detect the
 * "shared family Strava account" collision case (HTTP 409 path).
 */
export async function findUserByAthleteStravaId(
  admin: SupabaseClient,
  athleteStravaId: number
): Promise<StravaTokenOwnershipCheck | null> {
  // service-role: explicit user filter required (filtered by athlete id;
  // ownership lookup is intentionally cross-user-readable for collision
  // detection, but writes always filter by user_id).
  const { data, error } = await admin
    .from("strava_tokens")
    .select("user_id")
    .eq("athlete_strava_id", athleteStravaId)
    .maybeSingle<StravaTokenOwnershipCheck>();
  if (error) {
    throw new Error(
      `findUserByAthleteStravaId failed: ${error.message}`
    );
  }
  return data;
}

/**
 * INSERT ... ON CONFLICT (user_id) DO UPDATE. Same-user reconnect replaces
 * the row atomically; cross-user collision should be rejected BEFORE this
 * call (see findUserByAthleteStravaId).
 *
 * Returns the persisted row's athlete_strava_id for the caller to echo
 * to the client.
 */
export async function upsertStravaToken(
  admin: SupabaseClient,
  row: StravaTokenWrite
): Promise<{ athlete_strava_id: number }> {
  // service-role: explicit user filter required (PK is user_id; upsert
  // is identity-scoped to the calling user only).
  const { data, error } = await admin
    .from("strava_tokens")
    .upsert(
      {
        user_id: row.user_id,
        access_token_enc: row.access_token_enc,
        refresh_token_enc: row.refresh_token_enc,
        expires_at: row.expires_at,
        scope: row.scope,
        athlete_strava_id: row.athlete_strava_id,
        key_version: row.key_version,
      },
      { onConflict: "user_id" }
    )
    .select("athlete_strava_id")
    .single<{ athlete_strava_id: number }>();
  if (error) {
    throw new Error(`upsertStravaToken failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("upsertStravaToken returned no row");
  }
  return data;
}
