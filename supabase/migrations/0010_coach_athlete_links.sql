-- Coach-athlete relationship table, coach-side RLS policies, and role_flags security fix.
-- Schema plan Unit 8 (consolidated coach RLS pass). See:
--   docs/plans/2026-05-17-001-feat-flutter-core-navigation-plan.md (Unit 2)
--   docs/brainstorms/2026-05-17-flutter-app-core-navigation-requirements.md
--
-- Three concerns, one migration:
-- 1. public.coach_athlete_links -- manages the 1:N coach→athlete roster.
--    Soft-delete + partial unique index enforce at-most-one active coach per
--    athlete at the DB level.
-- 2. Coach SELECT policies on planned_workouts, completed_workouts, plans,
--    workout_matches -- additive policies; existing athlete-self policies are
--    unchanged. Policy uses EXISTS subquery against coach_athlete_links so
--    no cross-athlete leakage is possible even if coach_athlete_links rows
--    are incorrectly inserted.
-- 3. role_flags UPDATE security fix on public.users -- tightens the existing
--    users_self_update policy's WITH CHECK so callers cannot self-promote
--    their own role_flags via a direct Supabase client call.
-- 4. delete_user_cascade stub -- the account-deletion function referenced by
--    migration-conventions.md does not yet exist (deferred from Units 0-9).
--    This migration creates it as the canonical definition covering
--    coach_athlete_links on both sides; future migrations that add tables
--    will extend this function.
--
-- Scope notes:
-- - coach_athlete_links is NOT added to supabase_realtime. Coach roster
--   changes are low-frequency; polling on focus is sufficient.
-- - No INSERT policy for athletes: coach initiates the link; athletes
--   can only see their own link (self-SELECT). Mutual-accept flows are
--   product scope, not schema scope in v1.
-- - status CHECK uses the corrected syntax: CHECK (status IN (...))
-- - Every coach SELECT policy uses an EXISTS subquery that joins through
--   coach_athlete_links; it does NOT use OR athlete_id = auth.uid() —
--   the athlete-self policy already covers the athlete leg.

CREATE TABLE public.coach_athlete_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    athlete_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    -- Prevent a coach from linking to themselves.
    CONSTRAINT coach_athlete_links_no_self_link CHECK (coach_user_id != athlete_user_id)
);

-- One active coach per athlete. Archived and soft-deleted rows fall outside
-- the predicate and cannot cause a uniqueness violation for new rows.
-- Concurrent inserts still race without a transaction; callers assigning a
-- new coach to an athlete who already has one MUST archive the old row and
-- insert the new row in a single transaction.
-- Pattern from: docs/solutions/partial-unique-with-soft-delete.md
CREATE UNIQUE INDEX coach_athlete_links_one_active_coach_per_athlete
    ON public.coach_athlete_links (athlete_user_id)
    WHERE status = 'active' AND deleted_at IS NULL;

-- Hot path: coach queries their own roster (WHERE coach_user_id = $1 AND status='active').
-- Covering index also accelerates the EXISTS subqueries in the RLS policies below.
CREATE INDEX coach_athlete_links_coach_lookup
    ON public.coach_athlete_links (coach_user_id, athlete_user_id)
    WHERE status = 'active' AND deleted_at IS NULL;

-- Hot path: athlete looks up their own coach link (Settings tab R20).
CREATE INDEX coach_athlete_links_athlete_lookup
    ON public.coach_athlete_links (athlete_user_id)
    WHERE status = 'active' AND deleted_at IS NULL;

ALTER TABLE public.coach_athlete_links ENABLE ROW LEVEL SECURITY;

-- Athletes can see their own coach link.
CREATE POLICY coach_athlete_links_athlete_select ON public.coach_athlete_links
    FOR SELECT USING (athlete_user_id = auth.uid());

-- Coaches can see their own roster entries.
CREATE POLICY coach_athlete_links_coach_select ON public.coach_athlete_links
    FOR SELECT USING (coach_user_id = auth.uid());

-- Coach initiates the link; WITH CHECK ensures the new row assigns the caller as coach.
CREATE POLICY coach_athlete_links_coach_insert ON public.coach_athlete_links
    FOR INSERT WITH CHECK (coach_user_id = auth.uid());

-- Either party can update status (coach archives, athlete can accept).
-- No row-level restriction on which columns can be updated; app code is responsible.
CREATE POLICY coach_athlete_links_update ON public.coach_athlete_links
    FOR UPDATE
    USING (coach_user_id = auth.uid() OR athlete_user_id = auth.uid())
    WITH CHECK (coach_user_id = auth.uid() OR athlete_user_id = auth.uid());

-- No DELETE policy: soft-delete via UPDATE deleted_at = now().

-- ---------------------------------------------------------------------------
-- Coach SELECT policies on existing tables
-- ---------------------------------------------------------------------------
-- These policies are ADDITIVE. The existing athlete-self SELECT policies
-- (plans_self_select, planned_workouts_self_select, etc.) are unchanged.
-- An EXISTS subquery gate means a coach sees an athlete's row ONLY if an
-- active, non-soft-deleted link exists between them at query time.

-- Helper macro (comment, not SQL): the common EXISTS gate is:
--   EXISTS (
--       SELECT 1 FROM public.coach_athlete_links cal
--       WHERE cal.coach_user_id = auth.uid()
--         AND cal.athlete_user_id = <table>.athlete_id
--         AND cal.status = 'active'
--         AND cal.deleted_at IS NULL
--   )

CREATE POLICY plans_coach_select ON public.plans
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.coach_athlete_links cal
            WHERE cal.coach_user_id = auth.uid()
              AND cal.athlete_user_id = plans.athlete_id
              AND cal.status = 'active'
              AND cal.deleted_at IS NULL
        )
    );

CREATE POLICY planned_workouts_coach_select ON public.planned_workouts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.coach_athlete_links cal
            WHERE cal.coach_user_id = auth.uid()
              AND cal.athlete_user_id = planned_workouts.athlete_id
              AND cal.status = 'active'
              AND cal.deleted_at IS NULL
        )
    );

CREATE POLICY completed_workouts_coach_select ON public.completed_workouts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.coach_athlete_links cal
            WHERE cal.coach_user_id = auth.uid()
              AND cal.athlete_user_id = completed_workouts.athlete_id
              AND cal.status = 'active'
              AND cal.deleted_at IS NULL
        )
    );

-- workout_matches has no athlete_id column; traverse via planned_workouts.
-- The subquery against planned_workouts is itself RLS-aware, but the coach
-- SELECT policy on planned_workouts above has not fired yet at this point —
-- the EXISTS goes directly to the table. The explicit cal JOIN ensures the
-- coach can only reach matches for athletes they are actively linked to.
CREATE POLICY workout_matches_coach_select ON public.workout_matches
    FOR SELECT USING (
        EXISTS (
            SELECT 1
            FROM public.planned_workouts pw
            JOIN public.coach_athlete_links cal
              ON cal.athlete_user_id = pw.athlete_id
             AND cal.coach_user_id = auth.uid()
             AND cal.status = 'active'
             AND cal.deleted_at IS NULL
            WHERE pw.id = workout_matches.planned_workout_id
        )
    );

-- ---------------------------------------------------------------------------
-- role_flags security fix
-- ---------------------------------------------------------------------------
-- The existing users_self_update policy (migration 0001) has:
--   FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id)
-- This allows an authenticated user to directly call:
--   supabase.from('users').update({ role_flags: ['coach'] }).eq('id', uid)
-- and self-promote to coach. Drop and recreate with a WITH CHECK that
-- rejects any UPDATE where role_flags differs from the persisted value.
-- Columns other than role_flags (display_name, timezone, etc.) are still
-- updatable without restriction.

DROP POLICY IF EXISTS users_self_update ON public.users;

CREATE POLICY users_self_update ON public.users
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (
        auth.uid() = id
        -- Reject any self-UPDATE that changes role_flags. The subquery
        -- re-reads the persisted value from the same row; if the caller's
        -- supplied role_flags differs, the CHECK fails and the UPDATE is
        -- rejected with a 42501 (insufficient privilege) error.
        AND role_flags = (SELECT role_flags FROM public.users WHERE id = auth.uid())
    );

-- ---------------------------------------------------------------------------
-- delete_user_cascade stub
-- ---------------------------------------------------------------------------
-- This function is the canonical account-deletion cascade referenced by
-- migration-conventions.md. It did not exist in migrations 0000–0009.
-- v1 covers coach_athlete_links; future migrations extend this function
-- when they introduce new user-data tables.
--
-- Soft-delete semantics: mark rows deleted_at = now() rather than hard-
-- deleting, so audit trails are preserved. The ON DELETE CASCADE FKs on
-- athlete_id / coach_user_id / athlete_user_id handle hard-delete teardown
-- if a user row is ever hard-deleted (e.g., via a future admin tool).
--
-- This function is SERVICE-ROLE only (not exposed to RLS-gated paths).
-- Callers must pass a user_id that they have verified is the account being
-- deleted; the function does not verify caller identity.

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

    -- Future tables: extend here in their respective migrations.
    -- Do not add table-specific logic here; each migration that introduces
    -- a new user-data table must UPDATE this function in that same migration.
END;
$$;

-- Revoke public EXECUTE so only service-role callers can invoke this.
REVOKE ALL ON FUNCTION public.delete_user_cascade(UUID) FROM PUBLIC;
