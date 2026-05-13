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
    source TEXT NOT NULL CHECK (source IN ('ai_generated', 'coach_assigned', 'imported')),
    -- FK to weekly_reviews(id) is deferred to schema plan Unit 7's migration.
    -- Plain UUID for now; nullable because most plans are not generated from a review.
    created_from_review_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

-- R7: at most one active plan per athlete. The partial WHERE clause makes
-- archived and soft-deleted rows non-blocking, so the natural archive-then-
-- create transition works without a multi-statement dance.
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
    -- ON DELETE SET NULL: a hard-deleted plan (account cascade only) leaves
    -- the workout row intact with plan_id=NULL. Soft-delete on plans does
    -- not fire this since the row still exists.
    plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
    scheduled_date DATE NOT NULL,
    sport TEXT NOT NULL CHECK (sport IN ('swim', 'bike', 'run', 'strength', 'mobility', 'other')),
    -- Permissive JSONB; inner shape converges with the AI prompt in product
    -- plan Unit 3.2. Zod schema in packages/shared/src/planned-workout.ts
    -- mirrors this permissiveness for now.
    structure JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- planned_load semantics (TSS-equivalent vs minutes vs custom) deferred
    -- to product plan Unit 2.3. Stored as a generic NUMERIC; callers must
    -- agree on the unit out-of-band until then.
    planned_load NUMERIC,
    status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'completed', 'skipped', 'moved')),
    rationale TEXT,
    -- Edit attribution columns. App-set on edits; no trigger. The durable
    -- audit log will live in workout_edits (schema plan Unit 7).
    edited_by_kind TEXT,
    edited_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    edited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- Calendar query: athlete + date-range, hot path. Partial index keeps it
-- small (soft-deleted workouts not indexed).
CREATE INDEX planned_workouts_calendar
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
