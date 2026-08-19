-- workout_reports: per-workout debrief (verdict + AI narrative), one row per
-- completed_workouts row. See:
--   docs/plans/2026-08-18-001-feat-workout-reports-plan.md (Unit 1, KTD1-KTD8)
--
-- Scope notes:
-- - This is a NET-NEW table, not an extension of weekly_reviews (KTD3).
--   weekly_reviews carries proposal semantics (proposed_changes, an
--   accept/reject status lifecycle, an apply-RPC that edits the plan). A
--   debrief has nothing to accept or apply -- reusing weekly_reviews would
--   mean permanently-'no_changes' rows and every consumer learning to ignore
--   half the columns.
-- - Only the narrative is persisted here. The verdict + comparison delta is
--   computed on read from completed_workouts / planned_workouts /
--   athlete_profiles (KTD2) -- this table has no columns for the delta
--   itself, only its narrated output.
-- - input_fingerprint is a stable hash over the material inputs named in
--   KTD4 (distance_m, duration_s, sport, summary_stats,
--   matched_planned_workout_id, planned_structure, planned_load,
--   superseded_by_id, plan_goal, plan_event_date). It is computed in
--   application code (apps/web/src/ai/reports/fingerprint.ts) and stored
--   verbatim; the DB has no opinion on its hash algorithm, only that a
--   fingerprint always accompanies a narrative (NOT NULL).
-- - verdict_code carries a CHECK matching the closed VerdictCode enum in
--   packages/shared/src/workout-report.ts, following trigger_kind/status in
--   weekly_reviews (0019). It is a second statement of that list, yes -- but
--   the column is no longer merely informational: the read path compares the
--   STORED code against the freshly-computed one to decide whether a cached
--   narrative still describes the same verdict category, and suppresses the
--   prose when it does not (WorkoutReportResponse.verdictChanged). A typo or
--   a drifted writer would silently defeat that comparison, and the enum
--   changes about as often as this table's shape does -- a migration is the
--   right place to notice.
-- - No INSERT/UPDATE/DELETE policies: writes are service-role only, from the
--   on-demand generation route (a later unit). That route runs under
--   service-role and MUST filter explicitly by the authenticated athlete's
--   id before writing -- RLS is not enforcing that path (see AGENTS.md "RLS
--   posture"). RLS here exists purely to scope client-side SELECTs.
-- - Realtime: workout_reports deliberately does NOT join supabase_realtime
--   (KTD6). Generation is user-initiated -- the client that triggers
--   POST .../report already knows the result from the response body, so
--   there is no push case to serve. REALTIME_ALLOWLIST in
--   packages/shared/src/realtime-allowlist.ts is intentionally NOT touched by
--   this migration; the publication-guard test would fail on drift if it
--   were.
-- - Soft-delete (deleted_at) is present for consistency with the
--   athlete-content convention in AGENTS.md. The FK CASCADEs below only fire
--   on a HARD delete of the parent workout or account; the delete path that
--   actually exists today (the MCP `workouts_completed_delete` tool) is a
--   SOFT delete, which no CASCADE can see. The trigger at the bottom of this
--   migration closes that gap, so a soft-deleted workout does not leave a
--   live report behind it.

CREATE TABLE public.workout_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- GDPR teardown + ownership scoping. CASCADE: a report has no meaning
    -- once its athlete is hard-deleted (mirrors weekly_reviews.athlete_id).
    athlete_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- The workout this report debriefs. CASCADE: a report cannot outlive the
    -- workout it is about (mirrors workout_matches' FKs in 0008).
    completed_workout_id UUID NOT NULL REFERENCES public.completed_workouts(id) ON DELETE CASCADE,
    -- LLM-authored coach's note (3-6 sentences) and forward-looking
    -- takeaway. Nullable: a row can exist with the verdict already computed
    -- on read (KTD2) but no narrative yet generated, or with a narrative
    -- generation that failed / was rate-limited (R13) and never got written.
    -- Length caps and the untrusted-LLM-string handling live in the Zod
    -- ReportNarrationSchema (packages/shared/src/workout-report.ts, Unit 2),
    -- the same pattern as weekly_reviews.narrative (0019).
    narrative TEXT,
    takeaway TEXT,
    -- Snapshot of the deterministic verdict the narrative was WRITTEN AGAINST.
    -- The live verdict is still always recomputed on read (KTD2) and is the
    -- one displayed -- this column is never shown. Its job is the comparison:
    -- when the recomputed code differs from this one, the stored prose is
    -- explaining a judgment the athlete is no longer being shown, and the
    -- read path suppresses it (WorkoutReportResponse.verdictChanged) instead
    -- of printing a note that contradicts the header above it.
    verdict_code TEXT CHECK (verdict_code IN (
        'executed_as_prescribed',
        'under_executed',
        'over_executed',
        'partial_data',
        'unplanned_effort'
    )),
    -- Cache key. NOT NULL: a row is only ever written together with the
    -- fingerprint of the inputs that produced its narrative -- there is no
    -- valid state where a narrative exists without one (KTD4).
    input_fingerprint TEXT NOT NULL,
    -- Which model produced the narrative (e.g. a Groq model id). Nullable
    -- for forward-compat with any non-generation write path; every real
    -- generation call is expected to set it.
    model TEXT,
    -- When the narrative was (re)generated. Distinct from created_at: a row
    -- is updated in place on regeneration (unique on completed_workout_id
    -- below), so generated_at moves forward while created_at does not.
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- One report per completed workout. Deliberately a PLAIN unique index (not
-- partial WHERE deleted_at IS NULL like workout_matches' re-linking indexes
-- in 0008) -- there is no re-linking flow here. Regeneration upserts the
-- existing row by completed_workout_id instead of soft-deleting and
-- re-inserting, so a stale/soft-deleted row never needs to make room for a
-- fresh one.
CREATE UNIQUE INDEX workout_reports_completed_workout_unique
    ON public.workout_reports (completed_workout_id);

-- Athlete/coach "recent reports" listing. Partial on deleted_at IS NULL,
-- mirroring completed_workouts_athlete_started (0008).
CREATE INDEX workout_reports_athlete_generated
    ON public.workout_reports (athlete_id, generated_at DESC)
    WHERE deleted_at IS NULL;

-- Note: athlete_id is expected to equal
-- (SELECT athlete_id FROM completed_workouts WHERE id = completed_workout_id),
-- but that cross-row consistency is NOT enforced by a FK or trigger here --
-- the same posture as workout_matches' planned/completed pairing in 0008.
-- Client writes are impossible (no INSERT/UPDATE policy below); the
-- service-role generation route is responsible for deriving athlete_id from
-- the authenticated caller and validating ownership of completed_workout_id
-- before writing.

-- No ALTER PUBLICATION here. Per KTD6, workout_reports is explicitly NOT a
-- supabase_realtime member; REALTIME_ALLOWLIST is intentionally untouched.

-- ===========================================================================
-- RLS
-- ===========================================================================

ALTER TABLE public.workout_reports ENABLE ROW LEVEL SECURITY;

-- Athlete reads their own reports.
CREATE POLICY workout_reports_self_select ON public.workout_reports
    FOR SELECT USING (auth.uid() = athlete_id);

-- Additive coach SELECT: a linked, active coach reads their athlete's
-- reports at the data layer (R11). Same EXISTS-subquery shape as
-- weekly_reviews_coach_select / workout_edits_coach_select (0019). No
-- coach-facing UI ships with this unit -- this policy is the whole of R11's
-- implementation for this plan.
CREATE POLICY workout_reports_coach_select ON public.workout_reports
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.coach_athlete_links cal
            WHERE cal.athlete_user_id = workout_reports.athlete_id
              AND cal.coach_user_id = auth.uid()
              AND cal.status = 'active'
              AND cal.deleted_at IS NULL
        )
    );

-- No INSERT/UPDATE/DELETE policies: the on-demand generation route writes
-- exclusively via a service-role client (explicit athlete-id filter
-- required there, per AGENTS.md), so RLS need not admit any client write
-- path at all. Mirrors weekly_reviews' write posture (0019).

-- ===========================================================================
-- delete_user_cascade: extend the canonical function (latest def is 0025)
-- ===========================================================================
-- workout_reports carries deleted_at, so it follows the weekly_reviews
-- precedent (soft-delete on cascade) rather than the "no deleted_at,
-- hard-cascade handles it" precedent used for workout_edits /
-- ai_generation_attempts / oauth_* in 0019/0024/0025.
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

    -- Soft-delete the athlete's per-workout reports.
    UPDATE public.workout_reports
    SET deleted_at = now()
    WHERE athlete_id = user_id
      AND deleted_at IS NULL;

    -- workout_edits: intentionally excluded (append-only, no deleted_at);
    -- removed by its athlete_id ON DELETE CASCADE on hard account delete.
    -- ai_generation_attempts / ai_plan_trials: same precedent -- no deleted_at,
    -- removed by their athlete/user ON DELETE CASCADE FKs on hard delete.
    -- oauth_authorization_codes / oauth_access_tokens: same precedent -- user_id
    -- ON DELETE CASCADE, no deleted_at; removed on hard delete. oauth_clients
    -- has no user column (global registrations), intentionally not cascaded.
    -- admin_audit_log: intentionally excluded (see 0016).

    -- Future tables: extend here in their respective migrations.
END;
$$;
REVOKE ALL ON FUNCTION public.delete_user_cascade(UUID) FROM PUBLIC;

-- ===========================================================================
-- Soft-delete cascade: completed_workouts -> workout_reports
-- ===========================================================================
-- `completed_workout_id ... ON DELETE CASCADE` above only fires on a HARD
-- delete. The delete path that exists today is a SOFT one (the MCP
-- `workouts_completed_delete` tool stamps completed_workouts.deleted_at), and
-- a FK cannot observe that -- the report row would stay live, still readable
-- under workout_reports' own RLS policies, still counted by the generation
-- quota, debriefing a workout the athlete believes they deleted.
--
-- Trigger rather than an application-side second write: the soft-delete
-- happens under the CALLER's client (MCP runs as the user), which has no
-- write policy on workout_reports at all -- an application-side cascade would
-- have to grant one, widening the table's write surface from
-- service-role-only to something clients can touch. A trigger keeps the
-- cascade inside the database where the delete itself happens.
CREATE OR REPLACE FUNCTION public.soft_delete_workout_reports_for_workout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.workout_reports
    SET deleted_at = NEW.deleted_at
    WHERE completed_workout_id = NEW.id
      AND deleted_at IS NULL;
    RETURN NEW;
END;
$$;

-- Fires only on the NULL -> non-NULL transition, so ordinary updates to a
-- completed workout (a re-sync, a summary_stats enrichment) never touch
-- workout_reports, and re-stamping an already-deleted row is a no-op.
CREATE TRIGGER completed_workouts_soft_delete_cascades_reports
    AFTER UPDATE OF deleted_at ON public.completed_workouts
    FOR EACH ROW
    WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
    EXECUTE FUNCTION public.soft_delete_workout_reports_for_workout();
