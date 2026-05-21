-- On-demand export artifact metadata. One row per export; the artifact bytes
-- live in a private Storage bucket at the deterministic path "<id>.ndjson.gz.enc"
-- so row <-> object are always linkable (the orphan sweep relies on this).
-- SERVICE-ROLE ONLY (RLS, no policies); not user-keyed; not in realtime.
--
-- Plan: docs/plans/2026-05-21-001-feat-admin-dashboard-plan.md (Unit 4)
--
-- Atomicity: the trigger route inserts status='pending' BEFORE dispatching the
-- Inngest job, so an upload that succeeds before the worker dies is never an
-- untracked orphan. The worker transitions pending -> running -> success|failed.

CREATE TABLE public.admin_backups (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status       TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'success', 'failed')),
    storage_path TEXT,
    size_bytes   BIGINT,
    key_version  INTEGER,
    table_counts JSONB,
    error        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- List newest-first (dashboard) + prune scans.
CREATE INDEX admin_backups_created_idx ON public.admin_backups (created_at);
-- "one running export at a time" guard + status filtering.
CREATE INDEX admin_backups_status_idx ON public.admin_backups (status);

ALTER TABLE public.admin_backups ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only (the export worker + admin routes).
