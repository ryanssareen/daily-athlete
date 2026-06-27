// Strava backfill state contracts. Phase C of the Strava integration.
//
// `BackfillStatusColumnSchema` mirrors `athlete_profiles.backfill_status`
// from supabase/migrations/0009_athlete_profiles_backfill_status.sql. The
// column is written exclusively by the Inngest backfill worker (service
// role) and read by mobile via supabase-js with JWT-bound RLS.
//
// Schema design:
// - Single object with optional `state` (not a `z.union([{}, populated])`).
//   The empty default `{}` parses cleanly as `state: undefined`; populated
//   rows carry the full record. Consumers branch on `state === undefined`,
//   not on union discriminator membership.
// - `error_code` is a CLOSED enum (not `z.string()`) to prevent a path
//   where raw `err.message` content leaks from the Inngest function ->
//   `backfill_status` -> mobile UI.
// - Migration 0009's CHECK constraint enforces the same invariants at the
//   DB layer (well-formed object, valid state if present, provider must
//   equal 'strava' if present). Zod + CHECK is belt-and-suspenders.
//
// Retry endpoint contracts (`StravaBackfillRetryErrorCodeSchema`,
// `StravaBackfillRetryResponseSchema`, etc.) live here too so the mobile
// client can import a single source of truth for both the DB column shape
// and the route envelope.
//
// Per the conventions header in athlete-profile.ts: one file per logical
// table-family/feature, exported schema named consistently, inferred TS
// type named with the same root.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Closed error-code enum used inside the column AND in any structured logs
// that emit `error_code`. Adding a new value requires the migration's CHECK
// constraint to be re-evaluated (no DB change needed; the CHECK only pins
// the `state` enum, not `error_code`), but app-layer auditability matters
// more than the DB guard here.
// ---------------------------------------------------------------------------

export const StravaBackfillErrorCodeSchema = z.enum([
  "needs_reauth",
  "rate_limited",
  "key_rotation",
  "max_retries_exhausted",
  "watchdog_demoted",
  "enqueue_failed",
  "network",
  "corrupt_state",
  // The serverless backfill noticed it was about to blow its function time
  // budget and exited cleanly with a real `completed` count. Distinct from
  // "watchdog_demoted", which the cron writes when a run was hard-killed
  // WITHOUT recording any terminal state.
  "timed_out",
  "unknown",
]);

export type StravaBackfillErrorCode = z.infer<typeof StravaBackfillErrorCodeSchema>;

// ---------------------------------------------------------------------------
// The shape stored in `athlete_profiles.backfill_status`.
//
// Every field is optional so the empty default `{}` round-trips; the
// presence of `state` is the "populated" signal. Mobile consumers should
// treat `state === undefined` as "implicit queued" (the user has never
// triggered a backfill, or the row predates Phase C).
//
// `estimated_total` is named to disambiguate from the final `completed`
// count in the `complete` state: the in-progress UI shows
// "completed of estimated_total"; the complete UI shows just `completed`.
// ---------------------------------------------------------------------------

export const BackfillStatusColumnSchema = z
  .object({
    provider: z.literal("strava").optional(),
    state: z
      .enum(["queued", "in_progress", "complete", "failed", "needs_reauth"])
      .optional(),
    completed: z.number().int().nonnegative().optional(),
    estimated_total: z.number().int().nonnegative().optional(),
    // Timestamps use `.datetime({ offset: true })` because PostgREST returns
    // TIMESTAMPTZ values in offset notation. Convention locked across the
    // per-table modules in packages/shared.
    started_at: z.string().datetime({ offset: true }).optional(),
    completed_at: z.string().datetime({ offset: true }).optional(),
    error_code: StravaBackfillErrorCodeSchema.optional(),
    // Human-readable failure detail for the UI and structured logs. UNLIKE
    // `error_code` (a closed enum for branching), this carries the ACTUAL
    // message from the error the worker caught — e.g. "strava_http_503" or
    // "Strava /athlete/activities unreachable: fetch timed out" — so the
    // onboarding/settings UI can show what really went wrong instead of a
    // generic template. The worker only ever populates this from its OWN
    // controlled error strings (never a raw Strava response body), and the
    // length bound keeps a stray token-bearing string from being persisted
    // wholesale even if one ever leaked into a message.
    error_detail: z.string().max(500).optional(),
    attempt: z.number().int().positive().optional(),
  })
  .strict();

export type BackfillStatusColumn = z.infer<typeof BackfillStatusColumnSchema>;

// ---------------------------------------------------------------------------
// Retry endpoint contracts -- POST /api/integrations/strava/backfill/retry.
// Mirrors the error-envelope pattern from strava-connect.ts.
// ---------------------------------------------------------------------------

export const StravaBackfillRetryErrorCodeSchema = z.enum([
  "unauthorized",
  "no_strava_connection",
  "already_in_progress",
  "needs_reconnect",
  "enqueue_failed",
  "internal_error",
]);

export type StravaBackfillRetryErrorCode = z.infer<
  typeof StravaBackfillRetryErrorCodeSchema
>;

export const StravaBackfillRetryResponseSchema = z.object({
  status: z.literal("queued"),
  // Snapshot of the new backfill_status the server just wrote -- mobile
  // uses this to update the UI without waiting for the next poll cycle.
  backfill_status: BackfillStatusColumnSchema,
});

export type StravaBackfillRetryResponse = z.infer<
  typeof StravaBackfillRetryResponseSchema
>;

// Mirrors the Phase B envelope shape from strava-connect.ts so mobile can
// parse both endpoints' error responses uniformly. The optional `message`
// is a human-readable hint only; clients should branch on `error`.
export const StravaBackfillRetryErrorResponseSchema = z.object({
  error: StravaBackfillRetryErrorCodeSchema,
  message: z.string().optional(),
});

export type StravaBackfillRetryErrorResponse = z.infer<
  typeof StravaBackfillRetryErrorResponseSchema
>;
