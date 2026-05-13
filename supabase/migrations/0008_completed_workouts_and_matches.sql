-- Completed workouts (the canonical record of every real-world effort) and
-- workout matches (the 1:1 link between planned and completed). See:
--   docs/plans/2026-05-13-002-feat-completed-workouts-and-matches-schema-plan.md
--   docs/brainstorms/2026-05-02-database-schema-requirements.md (R14-R22)
--
-- Two tables, one migration:
-- - public.completed_workouts -- one row per real-world effort. source is
--   'strava' (idempotent via partial unique on athlete_id +
--   strava_activity_id) or 'manual' (strava_activity_id is NULL).
-- - public.workout_matches -- 1:1 link between a planned and a completed
--   workout. Two partial unique indexes (one per side, WHERE deleted_at IS
--   NULL) enforce the cardinality; re-linking is achieved by soft-deleting
--   the existing match and inserting a new one.
--
-- Scope notes:
-- - Coach-side RLS is deferred to schema plan Unit 8. Only athlete-self
--   policies live here.
-- - DO NOT store raw stream samples (HR/power/pace at 1Hz, etc.) per R18 /
--   Strava ToS. Only summary statistics (avg/max/zones, normalized power,
--   TSS-equivalent) go in summary_stats JSONB. Raw payloads continue to
--   live with bounded retention in strava_raw_payloads (migration 0002).
-- - On Strava `delete` events, app code soft-deletes the row (sets
--   deleted_at). If this was the only completion link for a planned
--   workout, app code transitions planned_workouts.status from 'completed'
--   back to 'planned'. The schema supports this; the orchestration is
--   product plan Unit 2.4.
-- - R21 manual-then-Strava merge: when a Strava webhook delivers an
--   effort already logged manually, app code INSERTs a new completed_workouts
--   row from Strava data and UPDATEs the manual row's superseded_by_id to
--   point at the Strava row. The manual row remains in the table for
--   forensic trace; canonical reads filter WHERE superseded_by_id IS NULL.
-- - workout_matches has no athlete_id column. RLS uses an EXISTS subquery
--   against planned_workouts; the subquery is RLS-aware, so users see
--   matches only for plans they own. completed_workout side is checked the
--   same way for INSERTs (WITH CHECK on EXISTS).
-- - Cross-row consistency between workout_matches.planned_workout_id and
--   workout_matches.completed_workout_id (they should belong to the same
--   athlete) is intentionally NOT enforced by SQL. App-layer matcher is
--   the only guard. Tests document the surprise.
-- - Both tables added to supabase_realtime publication. REALTIME_ALLOWLIST
--   in packages/shared/src/realtime-allowlist.ts must be updated to
--   include both in alphabetical order (with the existing plans /
--   planned_workouts entries).
-- - Soft-delete (deleted_at TIMESTAMPTZ) is the user-facing teardown path
--   for both tables. Hard-delete reserved for the future account-deletion
--   cascade.
-- - No `updated_at` or touch_updated_at trigger on either table. Lifecycle
--   tracked by explicit columns: completed_workouts has deleted_at and
--   superseded_by_id; workout_matches has matched_at and deleted_at.

CREATE TABLE public.completed_workouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('strava', 'manual')),
    -- Nullable: manual rows have NULL; Strava rows carry the activity id.
    -- The partial unique index below enforces idempotency for Strava rows
    -- without constraining manual rows (athletes can log multiple ad-hoc
    -- workouts per day).
    strava_activity_id BIGINT,
    started_at TIMESTAMPTZ NOT NULL,
    sport TEXT NOT NULL CHECK (sport IN ('swim', 'bike', 'run', 'strength', 'mobility', 'other')),
    -- First-class columns Strava always provides; nullable to support
    -- sparse manual entries.
    distance_m NUMERIC,
    duration_s INTEGER,
    -- Permissive JSONB; final shape per product plan Unit 2.2 (Strava
    -- normalization).
    summary_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- R21: when a manual row is merged into a Strava row, this points at
    -- the canonical (Strava) row. ON DELETE SET NULL preserves the
    -- supersession trail if the canonical row is ever hard-deleted (only
    -- via the account-deletion cascade).
    superseded_by_id UUID REFERENCES public.completed_workouts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- R15: idempotent Strava upsert. Webhook delivery is at-least-once;
-- multiple deliveries of the same effort must produce exactly one row.
-- Callers should use:
--   INSERT INTO completed_workouts (athlete_id, source, strava_activity_id, ...)
--   VALUES (...)
--   ON CONFLICT (athlete_id, strava_activity_id) DO UPDATE SET
--     summary_stats = EXCLUDED.summary_stats, ...
-- to make webhook handlers replay-safe.
CREATE UNIQUE INDEX completed_workouts_strava_idempotency
    ON public.completed_workouts (athlete_id, strava_activity_id)
    WHERE strava_activity_id IS NOT NULL;

-- Trend query: "athlete's last N completed workouts" / "completed workouts
-- in date range." Partial keeps it small (soft-deleted rows excluded).
CREATE INDEX completed_workouts_athlete_started
    ON public.completed_workouts (athlete_id, started_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE public.workout_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planned_workout_id UUID NOT NULL REFERENCES public.planned_workouts(id) ON DELETE CASCADE,
    completed_workout_id UUID NOT NULL REFERENCES public.completed_workouts(id) ON DELETE CASCADE,
    confidence NUMERIC NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    method TEXT NOT NULL CHECK (method IN ('auto_same_day_sport', 'manual_user_link', 'merged_from_manual')),
    matched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- R19/R20: at most one LIVE match per planned workout. Soft-deleting the
-- existing match (UPDATE deleted_at = now()) drops it from the partial
-- predicate and allows a fresh INSERT to take its place. This is how
-- coach/athlete re-linking works.
CREATE UNIQUE INDEX workout_matches_one_per_planned
    ON public.workout_matches (planned_workout_id)
    WHERE deleted_at IS NULL;

-- R19/R20 (symmetric on the completed side): at most one LIVE match per
-- completed workout.
CREATE UNIQUE INDEX workout_matches_one_per_completed
    ON public.workout_matches (completed_workout_id)
    WHERE deleted_at IS NULL;

-- Realtime publication membership. Both tables broadcast to mobile + web
-- subscribers. REALTIME_ALLOWLIST in packages/shared/src/realtime-allowlist.ts
-- must list completed_workouts and workout_matches alongside the existing
-- planned_workouts and plans entries; the CI guard verifies the match.
ALTER PUBLICATION supabase_realtime ADD TABLE public.completed_workouts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.workout_matches;

ALTER TABLE public.completed_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_matches ENABLE ROW LEVEL SECURITY;

-- Completed workouts: athlete-self. Coach-side SELECT lands in Unit 8.
CREATE POLICY completed_workouts_self_select ON public.completed_workouts
    FOR SELECT USING (auth.uid() = athlete_id);

CREATE POLICY completed_workouts_self_insert ON public.completed_workouts
    FOR INSERT WITH CHECK (auth.uid() = athlete_id);

CREATE POLICY completed_workouts_self_update ON public.completed_workouts
    FOR UPDATE USING (auth.uid() = athlete_id) WITH CHECK (auth.uid() = athlete_id);

-- No DELETE policy: soft-delete via UPDATE deleted_at. Hard-delete reserved
-- for the future account-deletion cascade.

-- Workout matches: athlete-self via EXISTS subquery against
-- planned_workouts (the subquery is itself RLS-aware, so this transitively
-- enforces ownership). INSERT WITH CHECK validates both sides belong to
-- the caller; UPDATE / SELECT validate the planned side (the completed
-- side is invariant per the immutable FK).
CREATE POLICY workout_matches_self_select ON public.workout_matches
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.planned_workouts pw
            WHERE pw.id = workout_matches.planned_workout_id
              AND pw.athlete_id = auth.uid()
        )
    );

CREATE POLICY workout_matches_self_insert ON public.workout_matches
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.planned_workouts pw
            WHERE pw.id = workout_matches.planned_workout_id
              AND pw.athlete_id = auth.uid()
        )
        AND EXISTS (
            SELECT 1 FROM public.completed_workouts cw
            WHERE cw.id = workout_matches.completed_workout_id
              AND cw.athlete_id = auth.uid()
        )
    );

CREATE POLICY workout_matches_self_update ON public.workout_matches
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.planned_workouts pw
            WHERE pw.id = workout_matches.planned_workout_id
              AND pw.athlete_id = auth.uid()
        )
    );

-- No DELETE policy: soft-delete via UPDATE deleted_at.
