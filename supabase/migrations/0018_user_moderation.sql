-- User moderation state: operator-driven account disable + soft-delete.
-- Adds two columns to public.users; no new table.
--
-- Plan:   docs/plans/2026-05-22-001-feat-admin-user-moderation-plan.md (Unit 1)
-- Origin: docs/brainstorms/2026-05-21-admin-dashboard-requirements.md
--         (Deferred (post-v1) -> User moderation)
--
-- Model:
-- - DISABLE  sets disabled_at (+ disabled_reason_code). Login is blocked by a
--   Supabase Auth ban applied in app code (auth.admin.updateUserById); these
--   columns are the app-visible mirror for the directory badge + restore
--   bookkeeping. Re-enable clears disabled_at and lifts the ban.
-- - SOFT-DELETE reuses the existing users.deleted_at (0001) as the tombstone +
--   30-day grace start; Restore clears it. Permanent purge
--   (delete_user_cascade + auth.admin.deleteUser) is a deferred sweeper and is
--   intentionally NOT performed here.
--
-- disabled_reason_code is a NORMALIZED, NON-PII code (see
-- packages/shared/src/users.ts ModerationReasonCodeSchema). The operator's
-- free-text reason is sent only in the moderation email, never persisted here
-- and never written to the immutable admin_audit_log.
--
-- No delete_user_cascade change (no new user-data table introduced).
-- No RLS policy change: login enforcement is the Auth ban, not RLS; public.users
-- keeps its existing policies + RLS coverage. Not added to supabase_realtime.

ALTER TABLE public.users
    ADD COLUMN disabled_at          TIMESTAMPTZ,
    ADD COLUMN disabled_reason_code TEXT;

-- Partial index mirrors users_deleted_at_idx (0001): the column is NULL for
-- ~all rows, so only index the disabled ones (directory "Disabled" filter,
-- future sweeps).
CREATE INDEX users_disabled_at_idx ON public.users (disabled_at)
    WHERE disabled_at IS NOT NULL;
