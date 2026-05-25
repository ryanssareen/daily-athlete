-- Monotonic row-version token on planned_workouts. The AI adaptive engine's
-- per-op staleness contract (Unit 6 apply) compares this version, NOT
-- edited_at -- because edited_at is stamped inconsistently across writers
-- (app-clock in the status route vs. DB now() in RPCs/Strava paths), is
-- millisecond-resolution, and the Strava completed->planned revert creates an
-- ABA case on status. A DB-side trigger guarantees every writer bumps the
-- token without touching each call site. See:
--   docs/plans/2026-05-25-001-feat-ai-adaptive-plans-engine-plan.md (Unit 1)
--
-- Bump policy: increment ONLY when a *plannable* column changes
-- (structure / scheduled_date / sport / planned_load / deleted_at). A
-- status-only change (e.g. the benign Strava completed->planned revert, or a
-- skip) must NOT invalidate a pending op that targets the row's plannable
-- content -- the apply RPC reads current status directly for its
-- completed/matched refusal, so status churn does not need to move the token.
--
-- The token is monotonic, not a strict +1-per-logical-edit counter: the
-- status-route completed path issues the complete RPC's UPDATE plus its own
-- post-RPC UPDATE, so version may advance by >1 per user action. The staleness
-- contract only requires strictly-increasing.

ALTER TABLE public.planned_workouts
    ADD COLUMN version BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.planned_workouts_bump_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.structure IS DISTINCT FROM OLD.structure
       OR NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
       OR NEW.sport IS DISTINCT FROM OLD.sport
       OR NEW.planned_load IS DISTINCT FROM OLD.planned_load
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
        NEW.version := OLD.version + 1;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER planned_workouts_version_bump
    BEFORE UPDATE ON public.planned_workouts
    FOR EACH ROW EXECUTE FUNCTION public.planned_workouts_bump_version();
