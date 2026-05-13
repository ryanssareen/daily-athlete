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
--   athlete) is NOT enforced by a FK or trigger -- but for AUTHENTICATED
--   callers, the INSERT WITH CHECK policy requires the caller to own both
--   sides (two EXISTS subqueries, each gated on auth.uid()). The UPDATE
--   policy mirrors this via its own WITH CHECK. Cross-athlete matches
--   can therefore only be created from the SERVICE-ROLE path (matcher
--   worker, account-deletion paths) where RLS is bypassed. The future
--   matcher in product plan Unit 2.4 MUST validate athlete identity
--   explicitly before insert.
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
    -- Sport vocabulary is intentionally identical to planned_workouts.sport
    -- (migration 0007). Any expansion of this enum MUST update both CHECK
    -- constraints in the SAME migration; otherwise the app-layer Zod
    -- SportSchema would accept a new value that one table rejects with
    -- 23514 at runtime.
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
    -- Hard-delete semantics caveat: if the canonical (Strava) row S is
    -- hard-deleted (only legal path is the account-deletion cascade), ON
    -- DELETE SET NULL clears the manual row M's superseded_by_id. M
    -- then reappears in canonical reads (WHERE superseded_by_id IS NULL).
    -- In practice this is harmless because the account-deletion cascade
    -- also CASCADEs through athlete_id and removes M. A targeted hard-
    -- delete of a single Strava row outside the account cascade is NOT
    -- a supported path; service-role callers must not do it.
    superseded_by_id UUID REFERENCES public.completed_workouts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    -- A Strava-sourced row MUST carry a strava_activity_id. Without this
    -- check, a buggy webhook payload (source='strava', strava_activity_id=
    -- NULL) would bypass the partial unique idempotency index and silently
    -- insert a duplicate row -- defeating R15.
    CONSTRAINT completed_workouts_strava_activity_id_required CHECK (
        source != 'strava' OR strava_activity_id IS NOT NULL
    ),
    -- Reject the trivial self-loop (a row pointing at itself). Longer
    -- cycles (M -> S -> M) are still permitted by SQL; preventing those
    -- requires a trigger and is tracked in the follow-up issue.
    CONSTRAINT completed_workouts_no_self_supersede CHECK (
        superseded_by_id IS NULL OR superseded_by_id != id
    )
);

-- R15: idempotent Strava upsert. Webhook delivery is at-least-once;
-- multiple deliveries of the same effort must produce exactly one row.
--
-- Raw SQL (server-side function, or direct pg connection) can use:
--   INSERT INTO completed_workouts (athlete_id, source, strava_activity_id, ...)
--   VALUES (...)
--   ON CONFLICT (athlete_id, strava_activity_id)
--     WHERE strava_activity_id IS NOT NULL
--     DO UPDATE SET summary_stats = EXCLUDED.summary_stats, ...
-- The WHERE clause is REQUIRED for Postgres to match the partial unique
-- index; without it, Postgres returns 42P10 ("no unique or exclusion
-- constraint matches").
--
-- LIMITATION: supabase-js's .upsert({...}, { onConflict: "athlete_id,
-- strava_activity_id" }) does NOT emit the WHERE clause and therefore
-- CANNOT be used for this partial-index conflict target -- it raises
-- 42P10 at runtime. Two supported supabase-js patterns:
--   (a) INSERT + catch 23505 + UPDATE fallback (pure SDK, two round-trips)
--   (b) RPC into a Postgres function that issues the raw INSERT ... ON
--       CONFLICT WHERE ... DO UPDATE (one round-trip, function is the
--       single source of truth for the upsert semantics)
-- See apps/web/src/db/__tests__/completed-workouts.test.ts which pins
-- both the 42P10 failure mode and the (a) fallback pattern.
--
-- With completed_workouts_strava_activity_id_required CHECK in place,
-- any source='strava' row carries a non-null strava_activity_id by
-- construction. Manual rows always have NULL strava_activity_id and
-- bypass the idempotency index entirely (the intended semantics).
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

-- Note: The EXISTS subqueries below do NOT filter pw.deleted_at IS NULL
-- or cw.deleted_at IS NULL. Athletes retain access to matches for
-- soft-deleted plans / completions (forensic trace). If a use case
-- requires hiding matches once their plan or completion is soft-deleted,
-- add the filter to the EXISTS clauses here.
--
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

-- WITH CHECK mirrors the INSERT policy: an UPDATE cannot re-point the row
-- to another user's planned or completed workout. Closes a metadata-leak
-- gap that would otherwise materialise once Unit 8 coach JOINs land.
CREATE POLICY workout_matches_self_update ON public.workout_matches
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.planned_workouts pw
            WHERE pw.id = workout_matches.planned_workout_id
              AND pw.athlete_id = auth.uid()
        )
    )
    WITH CHECK (
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

-- No DELETE policy: soft-delete via UPDATE deleted_at.
