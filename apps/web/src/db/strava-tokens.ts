// Service-role DB helpers for the public.strava_tokens table.
//
// strava_tokens has no INSERT/UPDATE RLS policy -- writes here are
// service-role only (AGENTS.md "Secrets"). Every function below carries
// an explicit:
//   // service-role: explicit user filter required
// next to the supabase-js call. Callers in route handlers MUST first
// confirm `auth.uid()` via the JWT-bound client; this module trusts the
// caller and writes by user_id without re-checking.
//
// BYTEA serialisation note:
//   supabase-js / PostgREST serialises the request body with JSON.stringify
//   under the hood. A bare Uint8Array becomes `{"0":65,"1":66,...}` -- a
//   JSON object, NOT a BYTEA hex literal -- and PostgREST rejects it with
//   a 422. We convert ciphertext to `\x<hex>` strings (the PostgREST BYTEA
//   wire format) before passing to supabase-js. The READ path
//   (decodeBytea in client.ts) already handles `\x<hex>` -- keep it as-is.

import "server-only";

import { Buffer } from "node:buffer";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { StravaAccountCollisionError } from "@/strava/errors";

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

function toByteaHex(bytes: Uint8Array): string {
  // PostgREST accepts BYTEA values as `\x<hex>` strings in JSON request
  // bodies. The double-backslash here is the JSON literal "\x"; on the
  // wire Postgres parses it as the standard hex-format binary prefix.
  return `\\x${Buffer.from(bytes).toString("hex")}`;
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

interface PgErrorLike {
  code?: string;
  message?: string;
  details?: string;
  constraint?: string;
}

function isAthleteStravaIdConstraint(err: PgErrorLike): boolean {
  // Postgres unique_violation. Distinguish the athlete_strava_id
  // collision from any other unique constraint (e.g. PK on user_id is
  // resolved by ON CONFLICT and shouldn't reach this branch, but defense
  // in depth). PostgREST surfaces `code` ('23505') and either
  // `constraint` or `details` ('Key (athlete_strava_id)=(...)').
  if (err.code !== "23505") return false;
  const constraint = err.constraint ?? "";
  const details = err.details ?? "";
  return (
    /athlete_strava_id/i.test(constraint) ||
    /athlete_strava_id/i.test(details)
  );
}

/**
 * INSERT ... ON CONFLICT (user_id) DO UPDATE. Same-user reconnect replaces
 * the row atomically; cross-user collision should be rejected BEFORE this
 * call (see findUserByAthleteStravaId). The
 * `strava_tokens_athlete_strava_id_idx` unique index is the race arbiter
 * if two callers slip past the pre-check simultaneously: we surface that
 * as a typed StravaAccountCollisionError so the route returns 409 rather
 * than an unstructured 500.
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
        // BYTEA columns must arrive as `\x<hex>` strings -- supabase-js
        // JSON.stringifies the body, and a Uint8Array becomes the wrong
        // JSON shape.
        access_token_enc: toByteaHex(row.access_token_enc),
        refresh_token_enc: toByteaHex(row.refresh_token_enc),
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
    const pgErr = error as PostgrestError as PgErrorLike;
    if (isAthleteStravaIdConstraint(pgErr)) {
      throw new StravaAccountCollisionError(row.athlete_strava_id);
    }
    throw new Error(`upsertStravaToken failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("upsertStravaToken returned no row");
  }
  return data;
}
