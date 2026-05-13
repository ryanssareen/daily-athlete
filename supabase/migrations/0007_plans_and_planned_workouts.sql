-- Plans and planned workouts: the foundation every athlete-facing feature
-- reads from. See:
--   docs/plans/2026-05-13-001-feat-plans-planned-workouts-schema-plan.md
--   docs/brainstorms/2026-05-02-database-schema-requirements.md (R7-R10)
--
-- Two tables, one migration:
-- - public.plans -- coarse-grained training plan. Status 'active'|'archived';
--   exactly one active plan per athlete (enforced by partial unique index).
-- - public.planned_workouts -- per-day workout. Optionally hangs off a plan
--   (plan_id may be NULL for ad-hoc workouts). Calendar query path.
-- - Two tables in one migration: plans and planned_workouts have a
--   foreign-key relationship (planned_workouts.plan_id -> plans.id).
--   Splitting them into separate migrations would force the FK
--   declaration into a third migration or leave a gap between
--   CREATE TABLE planned_workouts and the FK addition. Single-
--   migration introduction of coupled tables matches the practice
--   AGENTS.md's "one logical change per migration" rule allows for
--   tightly-coupled co-introduction.
--
-- Scope notes:
-- - Coach-side RLS is deferred to schema plan Unit 8 (consolidated coach RLS
--   pass). Only athlete-self policies live here.
-- - `plans.created_from_review_id` is declared as plain UUID with NO FK
--   constraint. The FK to weekly_reviews(id) is added in the migration that
--   introduces that table (schema plan Unit 7). Comment retained there so a
--   future audit sees the deliberate deferral.
-- - Both tables ARE intentionally added to supabase_realtime: mobile + web
--   subscribe to calendar updates. REALTIME_ALLOWLIST in
--   packages/shared/src/realtime-allowlist.ts must be updated in the same PR;
--   the CI guard (apps/web/src/db/__tests__/realtime-publication.test.ts)
--   verifies the match.
-- - Soft-delete (deleted_at TIMESTAMPTZ) is the user-facing teardown path
--   for both tables. Hard-delete is reserved for the future
--   delete_user_cascade function (schema plan Unit 10). The FK ON DELETE
--   CASCADE on athlete_id covers account-deletion teardown; the function
--   should still list both tables for clarity.
-- - No `updated_at` column or touch_updated_at trigger on either table.
--   Lifecycle is tracked by explicit columns: plans has archived_at and
--   deleted_at; planned_workouts has edited_at (app-set on edit) and
--   deleted_at. updated_at would be redundant.
-- - `edited_at` on planned_workouts is app-set, not trigger-driven. It's
--   the live-state edit attribution; the durable audit log lives in
--   workout_edits (schema plan Unit 7).
-- - athlete_id <-> plan_id cross-row consistency (a planned workout's
--   athlete should match its plan's athlete) is intentionally NOT enforced
--   by SQL -- ad-hoc workouts need athlete_id independently of plan_id.
--   This is an app-layer invariant; the test in
--   apps/web/src/db/__tests__/planned-workouts.test.ts documents that the
--   DB does NOT enforce it.

CREATE TABLE public.plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    event_type TEXT,
    event_date DATE,
    -- No DEFAULT by design: callers must explicitly specify source
    -- ('ai_generated' from the AI generation endpoint, 'coach_assigned'
    -- from coach-created plans, 'imported' from migration paths).
    source TEXT NOT NULL CHECK (source IN ('ai_generated', 'coach_assigned', 'imported')),
    -- FK to weekly_reviews(id) is deferred to schema plan Unit 7's
    -- migration. Plain UUID for now; nullable because most plans are
    -- not generated from a review.
    --
    -- Strategy when Unit 7 lands: add the FK with NOT VALID first
    -- (so existing rows are not validated synchronously), then run
    -- VALIDATE CONSTRAINT in a separate migration after backfilling
    -- any orphaned UUIDs to NULL. This avoids a 23503 if any stale
    -- data exists in this column at the time the FK is introduced.
    created_from_review_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    -- Enforces that an archived plan has archived_at set. Active plans
    -- have archived_at NULL by convention but this is not asserted; if
    -- a plan flips back to active, archived_at can remain set.
    CONSTRAINT plans_archived_at_matches_status CHECK (
        (status = 'archived' AND archived_at IS NOT NULL)
        OR (status = 'active')
    )
);

-- Callers performing the archive-then-create transition (archive the
-- existing active plan, INSERT a new one) MUST do so in a single
-- transaction. Without that, a concurrent request can INSERT a new
-- active plan between the UPDATE and the new INSERT, producing two
-- active plans (the partial unique index won't help: both INSERTs
-- pass the predicate at write time before either commits).
-- One active plan per athlete (status='active' AND deleted_at IS NULL).
-- The partial WHERE makes archived and soft-deleted rows non-blocking,
-- so the natural archive-then-create transition works without a
-- multi-statement dance.
CREATE UNIQUE INDEX plans_one_active_per_athlete
    ON public.plans (athlete_id)
    WHERE status = 'active' AND deleted_at IS NULL;

-- Listing plans for an athlete (active + archived, excluding soft-deleted).
CREATE INDEX plans_athlete_lookup
    ON public.plans (athlete_id)
    WHERE deleted_at IS NULL;

CREATE TABLE public.planned_workouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- Soft-delete of a plan does NOT null plan_id on planned_workouts
    -- (ON DELETE SET NULL only fires on hard-delete, which is reserved
    -- for the account-deletion cascade). Any read path that JOINs
    -- planned_workouts to plans MUST filter plans.deleted_at IS NULL
    -- to exclude logically-deleted plans -- otherwise workouts from
    -- soft-deleted plans surface as ghosts.
    -- ON DELETE SET NULL: a hard-deleted plan (account cascade only) leaves
    -- the workout row intact with plan_id=NULL. Soft-delete on plans does
    -- not fire this since the row still exists.
    plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
    scheduled_date DATE NOT NULL,
    sport TEXT NOT NULL CHECK (sport IN ('swim', 'bike', 'run', 'strength', 'mobility', 'other')),
    -- Permissive JSONB; tighten in product plan Unit 3.2 once AI prompt converges.
    structure JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Generic NUMERIC; units (TSS-equivalent / minutes / custom) deferred to product plan Unit 2.3.
    planned_load NUMERIC,
    status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'completed', 'skipped', 'moved')),
    rationale TEXT,
    -- App-set on edits. Durable audit log is workout_edits (Unit 7).
    edited_by_kind TEXT,
    edited_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    edited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- Calendar query: athlete + date-range, hot path. Partial index keeps it
-- small (soft-deleted workouts not indexed).
CREATE INDEX planned_workouts_athlete_date
    ON public.planned_workouts (athlete_id, scheduled_date)
    WHERE deleted_at IS NULL;

-- Realtime publication membership. Both tables are intentionally included
-- so mobile and web can subscribe to calendar updates.
-- REALTIME_ALLOWLIST in packages/shared/src/realtime-allowlist.ts MUST list
-- these same two tables; the CI guard verifies the match.
ALTER PUBLICATION supabase_realtime ADD TABLE public.plans;
ALTER PUBLICATION supabase_realtime ADD TABLE public.planned_workouts;

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planned_workouts ENABLE ROW LEVEL SECURITY;

-- Plans: athlete-self only. Coach-side SELECT policy lands in schema plan Unit 8.
CREATE POLICY plans_self_select ON public.plans
    FOR SELECT USING (auth.uid() = athlete_id);

CREATE POLICY plans_self_insert ON public.plans
    FOR INSERT WITH CHECK (auth.uid() = athlete_id);

CREATE POLICY plans_self_update ON public.plans
    FOR UPDATE USING (auth.uid() = athlete_id) WITH CHECK (auth.uid() = athlete_id);

-- No DELETE policy: soft-delete via UPDATE deleted_at. Hard-delete reserved
-- for the future account-deletion cascade.

-- Planned workouts: athlete-self only. Coach-side SELECT + UPDATE policies
-- land in schema plan Unit 8 (coaches can edit their athletes' workouts).
CREATE POLICY planned_workouts_self_select ON public.planned_workouts
    FOR SELECT USING (auth.uid() = athlete_id);

CREATE POLICY planned_workouts_self_insert ON public.planned_workouts
    FOR INSERT WITH CHECK (auth.uid() = athlete_id);

CREATE POLICY planned_workouts_self_update ON public.planned_workouts
    FOR UPDATE USING (auth.uid() = athlete_id) WITH CHECK (auth.uid() = athlete_id);

-- No DELETE policy: soft-delete via UPDATE deleted_at.
