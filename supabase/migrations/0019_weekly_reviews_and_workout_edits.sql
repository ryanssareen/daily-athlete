-- AI adaptive plans foundation: weekly_reviews (proposal records) and
-- workout_edits (append-only edit audit log). See:
--   docs/plans/2026-05-25-001-feat-ai-adaptive-plans-engine-plan.md (Unit 1)
--   docs/brainstorms/2026-05-02-database-schema-requirements.md (R11, R28, R29)
--
-- Two coupled tables in one migration (AGENTS.md permits tightly-coupled
-- co-introduction): weekly_reviews produces workout_edits on accept
-- (workout_edits.weekly_review_id -> weekly_reviews.id).
--
-- This migration also closes the forward-declared FK from 0007:
-- plans.created_from_review_id -> weekly_reviews(id). Per 0007's instruction the
-- FK is added NOT VALID here (after backfilling any orphans to NULL); the
-- VALIDATE CONSTRAINT runs in 0020 so its scan doesn't share this migration's
-- heavier DDL locks.
--
-- Scope notes:
-- - weekly_reviews.status is written ONLY by the apply RPC (Unit 6,
--   migration 0022), which runs SECURITY DEFINER as service_role and bypasses
--   RLS. There is deliberately NO athlete self-UPDATE policy: a general
--   self-UPDATE would let an athlete forge proposed -> accepted (desyncing the
--   record from planned_workouts) or tamper proposed_changes to inject
--   unvalidated ops -- the same class of hole 0010 fixed for users.role_flags.
-- - Recipient routing (plan Unit 1/6): proposals for athletes with an active
--   coach link route to the coach (recipient='coach'); solo athletes self-serve
--   (recipient='athlete'). Coaches therefore get a SELECT policy on their
--   linked athletes' proposals (mirrors the additive coach SELECT pattern from
--   0010). recipient drives accept-authority in the route handler + RPC.
-- - workout_edits is append-only and holds athlete training data (field-level
--   diffs of plannable columns). UNLIKE admin_audit_log (a permanent
--   compliance log scrubbed-but-kept on user deletion), workout_edits is
--   subject to GDPR erasure: athlete_id is ON DELETE CASCADE so the rows are
--   removed when the athlete is hard-deleted. The immutability trigger below
--   therefore blocks UPDATE (tampering with recorded history) but NOT DELETE
--   (the account-deletion cascade needs it; app clients are blocked by the
--   absence of a DELETE policy). The one permitted UPDATE is the
--   actor_user_id ON DELETE SET NULL scrub (e.g. a coach actor is deleted while
--   the athlete remains).
-- - Both tables join supabase_realtime: the athlete/coach proposal surface and
--   the calendar attribution subscribe to them. REALTIME_ALLOWLIST in
--   packages/shared/src/realtime-allowlist.ts is updated in the same PR; the CI
--   guard (apps/web/src/db/__tests__/realtime-publication.test.ts) enforces the
--   match.

-- ===========================================================================
-- weekly_reviews
-- ===========================================================================

CREATE TABLE public.weekly_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- A proposal always targets one plan. Hard-delete only happens on the
    -- account cascade (same athlete), so CASCADE is safe here.
    plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
    -- Provenance: which trigger produced this proposal. SQL CHECK kept tight;
    -- the Zod TriggerKindSchema is the enforced contract at API boundaries.
    trigger_kind TEXT NOT NULL CHECK (trigger_kind IN (
        'weekly', 'missed_block', 'schedule_shock', 'event_change',
        'fatigue_deload', 'progression_bump', 'workout_swap', 'manual'
    )),
    scope TEXT NOT NULL CHECK (scope IN ('plan', 'workout')),
    recipient TEXT NOT NULL CHECK (recipient IN ('athlete', 'coach')),
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN (
        'proposed', 'accepted', 'partially_accepted', 'rejected',
        'superseded', 'expired', 'no_changes'
    )),
    -- The validated op list with per-op {version} baselines (see Unit 6 apply).
    -- Permissive JSONB at the SQL layer; shape enforced by the Zod
    -- ProposedEdit[] contract in packages/shared.
    proposed_changes JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Athlete-facing rationale (length-capped in Zod; untrusted LLM string).
    narrative TEXT,
    -- Snapshot of plans.event_date at generation, for the plan-context
    -- staleness check at apply (NULL-safe IS DISTINCT FROM).
    event_date_snapshot DATE,
    -- Earliest scheduled_date any op touches; drives the expiry sweeper.
    earliest_affected_date DATE,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- One OPEN, PLAN-SCOPED proposal per athlete. Workout-scoped (B7) and
-- athlete-initiated proposals are exempt (scope='workout' rows never enter the
-- index). Mirrors plans_one_active_per_athlete (0007).
--
-- CONCURRENCY: like every partial-unique transition in this repo, the index
-- DETECTS a concurrent violation as 23505 at commit -- it does NOT serialize.
-- The engine's supersede-then-insert (Unit 5) must take a per-athlete advisory
-- lock (or SELECT ... FOR UPDATE on the active plans row) inside one
-- transaction, and treat a 23505 as a clean no-op ("another proposal won").
CREATE UNIQUE INDEX weekly_reviews_one_open_plan_scoped
    ON public.weekly_reviews (athlete_id)
    WHERE status = 'proposed' AND scope = 'plan' AND deleted_at IS NULL;

-- Lookup: an athlete's (or coach's) live proposals by status.
CREATE INDEX weekly_reviews_athlete_status
    ON public.weekly_reviews (athlete_id, status)
    WHERE deleted_at IS NULL;

-- Expiry sweeper (Unit 7): find proposed rows whose earliest-affected date has
-- passed. Partial keeps it to live, still-open proposals.
CREATE INDEX weekly_reviews_expiry_scan
    ON public.weekly_reviews (earliest_affected_date)
    WHERE status = 'proposed' AND deleted_at IS NULL;

-- ===========================================================================
-- workout_edits (append-only audit log)
-- ===========================================================================

CREATE TABLE public.workout_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- GDPR teardown: the athlete's edit history is removed on account deletion.
    athlete_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- The workout this edit applied to. CASCADE (not SET NULL): a hard-deleted
    -- planned_workout only happens on the account cascade (same athlete), so the
    -- audit row goes with it. Avoids a SET-NULL UPDATE the immutability trigger
    -- would otherwise have to special-case.
    planned_workout_id UUID REFERENCES public.planned_workouts(id) ON DELETE CASCADE,
    -- Back-reference to the proposal that produced this edit (NULL for direct
    -- athlete/coach edits). CASCADE for the same reason as planned_workout_id.
    weekly_review_id UUID REFERENCES public.weekly_reviews(id) ON DELETE CASCADE,
    actor_role TEXT NOT NULL CHECK (actor_role IN ('athlete', 'coach', 'ai_review')),
    -- The acting user. SET NULL (not CASCADE): a coach actor may be deleted
    -- while the athlete (and their audit row) remain -- scrub the reference,
    -- keep the row. This is the one UPDATE the immutability trigger permits.
    actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    -- Field-level diff of the plannable columns that changed.
    field_diff JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workout_edits_planned_workout
    ON public.workout_edits (planned_workout_id);
CREATE INDEX workout_edits_athlete_created
    ON public.workout_edits (athlete_id, created_at);

-- Append-only immutability. Blocks all UPDATEs EXCEPT the actor_user_id
-- ON DELETE SET NULL scrub. DELETE is intentionally NOT blocked here (the
-- account-deletion cascade must remove the athlete's rows for GDPR erasure;
-- app clients are blocked by the absence of a DELETE policy below). This
-- diverges deliberately from admin_audit_log (0016), which is a permanent
-- compliance log and blocks DELETE.
CREATE OR REPLACE FUNCTION public.workout_edits_no_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Allow ONLY the actor_user_id SET NULL cascade (non-null -> null, every
    -- other column unchanged).
    IF OLD.actor_user_id IS NOT NULL
       AND NEW.actor_user_id IS NULL
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.athlete_id IS NOT DISTINCT FROM OLD.athlete_id
       AND NEW.planned_workout_id IS NOT DISTINCT FROM OLD.planned_workout_id
       AND NEW.weekly_review_id IS NOT DISTINCT FROM OLD.weekly_review_id
       AND NEW.actor_role IS NOT DISTINCT FROM OLD.actor_role
       AND NEW.field_diff IS NOT DISTINCT FROM OLD.field_diff
       AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'workout_edits is append-only; UPDATE is not permitted';
END;
$$;

CREATE TRIGGER workout_edits_no_mutate
    BEFORE UPDATE ON public.workout_edits
    FOR EACH ROW EXECUTE FUNCTION public.workout_edits_no_update();

-- ===========================================================================
-- Realtime publication
-- ===========================================================================
-- REALTIME_ALLOWLIST in packages/shared/src/realtime-allowlist.ts MUST list
-- these two tables; the CI guard verifies the match.
ALTER PUBLICATION supabase_realtime ADD TABLE public.weekly_reviews;
ALTER PUBLICATION supabase_realtime ADD TABLE public.workout_edits;

-- ===========================================================================
-- RLS
-- ===========================================================================

ALTER TABLE public.weekly_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_edits ENABLE ROW LEVEL SECURITY;

-- weekly_reviews: athlete reads own proposals.
CREATE POLICY weekly_reviews_self_select ON public.weekly_reviews
    FOR SELECT USING (auth.uid() = athlete_id);

-- weekly_reviews: a linked coach reads their athletes' proposals (recipient
-- routing). Additive EXISTS-subquery policy, same shape as 0010's coach
-- policies on plans/planned_workouts.
CREATE POLICY weekly_reviews_coach_select ON public.weekly_reviews
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.coach_athlete_links cal
            WHERE cal.athlete_user_id = weekly_reviews.athlete_id
              AND cal.coach_user_id = auth.uid()
              AND cal.status = 'active'
              AND cal.deleted_at IS NULL
        )
    );

-- No INSERT/UPDATE/DELETE policies on weekly_reviews: the engine inserts and
-- the apply RPC updates status, both service-role (SECURITY DEFINER). RLS
-- denies all client writes by default -- this is what makes status RPC-only.

-- workout_edits: athlete reads own edit history.
CREATE POLICY workout_edits_self_select ON public.workout_edits
    FOR SELECT USING (auth.uid() = athlete_id);

-- workout_edits: a linked coach reads their athletes' edit history.
CREATE POLICY workout_edits_coach_select ON public.workout_edits
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.coach_athlete_links cal
            WHERE cal.athlete_user_id = workout_edits.athlete_id
              AND cal.coach_user_id = auth.uid()
              AND cal.status = 'active'
              AND cal.deleted_at IS NULL
        )
    );

-- No INSERT/UPDATE/DELETE policies on workout_edits: service-role appends;
-- the immutability trigger blocks UPDATE even for service-role; DELETE is
-- reserved for the account-deletion cascade.

-- ===========================================================================
-- Close the forward-declared FK: plans.created_from_review_id -> weekly_reviews
-- ===========================================================================
-- Backfill any orphaned values to NULL first (there should be none -- nothing
-- has written this column before weekly_reviews existed -- but 0007 prescribes
-- this exact order so the NOT VALID add can never trip 23503).
UPDATE public.plans
SET created_from_review_id = NULL
WHERE created_from_review_id IS NOT NULL
  AND created_from_review_id NOT IN (SELECT id FROM public.weekly_reviews);

-- ON DELETE SET NULL: deleting a weekly_review must not block teardown of the
-- plan that points at it (mirrors the non-identity-FK convention, e.g.
-- planned_workouts.edited_by_user_id in 0007). Added NOT VALID so existing rows
-- are not validated synchronously; VALIDATE CONSTRAINT runs in 0020.
ALTER TABLE public.plans
    ADD CONSTRAINT plans_created_from_review_fk
    FOREIGN KEY (created_from_review_id)
    REFERENCES public.weekly_reviews(id) ON DELETE SET NULL
    NOT VALID;

-- ===========================================================================
-- delete_user_cascade: extend the canonical function (latest def is 0016)
-- ===========================================================================
-- Soft-delete weekly_reviews for the user (it carries deleted_at, like
-- coach_athlete_links). workout_edits is intentionally EXCLUDED: it is
-- append-only and has no deleted_at, and its athlete_id ON DELETE CASCADE
-- removes it on the hard account-delete -- mirroring how admin_audit_log is
-- handled, except workout_edits IS removed (GDPR) rather than preserved.
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

    -- Soft-delete the athlete's AI proposals.
    UPDATE public.weekly_reviews
    SET deleted_at = now()
    WHERE athlete_id = user_id
      AND deleted_at IS NULL;

    -- workout_edits: intentionally excluded (append-only, no deleted_at).
    -- The athlete_id ON DELETE CASCADE removes these on hard account delete.

    -- admin_audit_log: intentionally excluded (see 0016).

    -- Future tables: extend here in their respective migrations.
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_cascade(UUID) FROM PUBLIC;
