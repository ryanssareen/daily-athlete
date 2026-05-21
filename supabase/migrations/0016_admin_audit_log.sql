-- Append-only admin audit log: an immutable record of every admin operation
-- (reads, exports, destructive actions). Service-role INSERT only; the admin
-- dashboard writes here via apps/web/src/db/admin-audit.ts.
--
-- Plan:   docs/plans/2026-05-21-001-feat-admin-dashboard-plan.md (Unit 2)
-- Origin: docs/brainstorms/2026-05-21-admin-dashboard-requirements.md (R2)
--
-- Immutability is enforced by a TRIGGER, not just RLS: the dashboard writes as
-- the service-role client, which BYPASSES RLS, so "no UPDATE/DELETE policy"
-- only stops anon/authenticated clients (who already can't write). A
-- BEFORE UPDATE OR DELETE trigger fires for the service-role too.
--
-- Metadata is NON-PII / structured only (action, ids, codes, counts) — never
-- emails/names/secrets — so this immutable table never becomes a
-- right-to-erasure problem. target_user_id is an FK with ON DELETE SET NULL so
-- the trail survives a user deletion while scrubbing the user reference.

CREATE TABLE public.admin_audit_log (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action         TEXT NOT NULL,
    target_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    target         TEXT,
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
    source         TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_log_created_idx ON public.admin_audit_log (created_at);
CREATE INDEX admin_audit_log_action_idx ON public.admin_audit_log (action);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
-- No policies: service-role INSERT only (service-role bypasses RLS). The
-- trigger below — not RLS — is what makes the table append-only.

-- ---------------------------------------------------------------------------
-- Immutability trigger
-- ---------------------------------------------------------------------------
-- Rejects every DELETE and every UPDATE EXCEPT the one update the FK
-- ON DELETE SET NULL cascade must perform: target_user_id non-null -> null
-- with every other column unchanged. Without that exception, deleting a user
-- referenced by an audit row would fail (the cascade's UPDATE would be blocked
-- by the trigger), making users undeletable. This permits the privacy-scrub
-- cascade while still blocking all real tampering (action/metadata/etc. are
-- frozen, and rows can never be deleted).
CREATE OR REPLACE FUNCTION public.admin_audit_log_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'admin_audit_log is append-only; DELETE is not permitted';
    END IF;
    -- TG_OP = 'UPDATE': allow ONLY the FK SET NULL cascade.
    IF OLD.target_user_id IS NOT NULL
       AND NEW.target_user_id IS NULL
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.action IS NOT DISTINCT FROM OLD.action
       AND NEW.target IS NOT DISTINCT FROM OLD.target
       AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
       AND NEW.source IS NOT DISTINCT FROM OLD.source
       AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'admin_audit_log is append-only; UPDATE is not permitted';
END;
$$;

CREATE TRIGGER admin_audit_log_no_mutate
    BEFORE UPDATE OR DELETE ON public.admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION public.admin_audit_log_immutable();

-- ---------------------------------------------------------------------------
-- delete_user_cascade: document the intentional exclusion
-- ---------------------------------------------------------------------------
-- admin_audit_log is intentionally NOT purged on user deletion: the FK above
-- (ON DELETE SET NULL) scrubs target_user_id while preserving the audit row,
-- so the trail outlives the user. Re-declare the canonical cascade (from 0010)
-- to record this exclusion explicitly; the body is otherwise unchanged.
CREATE OR REPLACE FUNCTION public.delete_user_cascade(user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Soft-delete all coach_athlete_links where the user is the coach side.
    UPDATE public.coach_athlete_links
    SET deleted_at = now(), status = 'archived'
    WHERE coach_user_id = user_id
      AND deleted_at IS NULL;

    -- Soft-delete all coach_athlete_links where the user is the athlete side.
    UPDATE public.coach_athlete_links
    SET deleted_at = now(), status = 'archived'
    WHERE athlete_user_id = user_id
      AND deleted_at IS NULL;

    -- admin_audit_log: intentionally excluded. The FK ON DELETE SET NULL on
    -- admin_audit_log.target_user_id scrubs the reference automatically; the
    -- append-only trail is preserved on purpose. Do NOT delete audit rows here.

    -- Future tables: extend here in their respective migrations.
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_cascade(UUID) FROM PUBLIC;
