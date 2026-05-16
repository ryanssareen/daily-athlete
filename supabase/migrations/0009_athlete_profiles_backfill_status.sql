-- Backfill status JSONB on athlete_profiles. Phase C of Strava integration.
-- See:
--   docs/plans/2026-05-16-001-feat-strava-phase-c-backfill-plan.md (Unit C1)
--   docs/brainstorms/2026-05-16-strava-phase-c-backfill-requirements.md
--
-- Scope notes:
-- - DDL safety: Default '{}'::jsonb is IMMUTABLE; Postgres 11+ stores the
--   default in pg_attribute.attmissingval and applies it virtually on read.
--   ALTER is metadata-only, no row rewrite. ACCESS EXCLUSIVE held for
--   catalog update only (microseconds at current scale).
-- - DO NOT ADD `athlete_profiles` TO supabase_realtime publication: per
--   AGENTS.md line 58 and 0004's own scope note, manual_fields contains
--   PII (age, weight). Mobile reads backfill_status via supabase-js with
--   JWT-bound RLS (4s focus-polling).
-- - No new RLS policies needed: the existing athlete_profiles_self_select
--   policy (from 0004) is row-level and automatically governs new columns.
--   Writes are service-role and bypass RLS.
-- - No delete_user_cascade entry needed: backfill_status is a column on
--   an existing user-scoped table; the existing FK cascade handles teardown.
-- - The lockstep trigger from 0005 fires on this column too but no-ops
--   because it only mutates manual_field_edited_at when manual_fields
--   IS DISTINCT FROM the OLD value. backfill_status-only writes pass through.
--
-- Schema shape: pinned by BackfillStatusColumnSchema in
-- packages/shared/src/strava-backfill.ts.
-- The CHECK constraint below is a minimal well-formed-ness guard;
-- enum/numeric validation lives in Zod at the boundary (consistent with
-- the pattern established for baselines, weekly_volume_ewma, manual_fields
-- in 0004 and summary_stats in 0008).
--
-- Rollback:
--   ALTER TABLE public.athlete_profiles
--     DROP CONSTRAINT athlete_profiles_backfill_status_well_formed;
--   ALTER TABLE public.athlete_profiles DROP COLUMN backfill_status;
-- Lossy but safe: backfill_status is derived state. To restore, re-enqueue
-- strava/backfill.start for every connected user_id (cf. strava_tokens rows).

SET lock_timeout = '5s';

ALTER TABLE public.athlete_profiles
    ADD COLUMN backfill_status JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Well-formed-ness guard: defense in depth against admin/fixture writes
-- that bypass the Zod boundary. Enforces:
--   (a) value is a JSONB object (not array, string, number, null)
--   (b) value is either {} (initial default) OR contains a 'state' key
--       whose value is in the supported state enum
--   (c) if 'provider' is present, it must equal 'strava' (single-provider
--       in v1; multi-provider expansion adds new enum members here AND in
--       BackfillStatusColumnSchema in lockstep).
ALTER TABLE public.athlete_profiles
    ADD CONSTRAINT athlete_profiles_backfill_status_well_formed CHECK (
        jsonb_typeof(backfill_status) = 'object'
        AND (
            backfill_status = '{}'::jsonb
            OR (
                backfill_status ? 'state'
                AND jsonb_typeof(backfill_status -> 'state') = 'string'
                AND (backfill_status ->> 'state') IN (
                    'queued', 'in_progress', 'complete', 'failed', 'needs_reauth'
                )
                AND (
                    NOT backfill_status ? 'provider'
                    OR (backfill_status ->> 'provider') = 'strava'
                )
            )
        )
    );

RESET lock_timeout;

COMMENT ON COLUMN public.athlete_profiles.backfill_status IS
    'Per-provider backfill state. Service-role writes only (Inngest backfill worker). '
    'NOT in supabase_realtime publication (athlete_profiles is forbidden per AGENTS.md). '
    'Mobile reads via supabase-js with JWT-bound RLS (4s focus-polling). '
    'Shape pinned by BackfillStatusColumnSchema in packages/shared/src/strava-backfill.ts. '
    'Empty object {} = pre-Phase-C row or never-connected; consumer treats as implicit "queued".';
