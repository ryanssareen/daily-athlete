-- AI plan generation persistence + the transactional create_ai_plan RPC. See:
--   docs/plans/2026-06-08-001-feat-ai-plan-generation-and-llm-client-plan.md (Units 5, 7)
--
-- Three things in one migration (all the durable surface the generation worker
-- needs to persist a plan exactly once):
--   1. public.ai_generation_attempts -- the idempotency + negative-cache store,
--      keyed unique on (athlete_id, request_id). A failed generation writes NO
--      plans row, so this table is the only durable home for "did request R
--      already run, and how did it end?". Self-SELECT RLS; service-role writes.
--   2. public.ai_plan_trials -- the one-free-plan conversion marker (Unit 7).
--      One row per user == the single free trial consumed. The RPC flips it in
--      the SAME transaction as the plan insert so a replay/race can't farm a
--      second free plan.
--   3. create_ai_plan(...) -- SECURITY DEFINER, archive-then-create in one
--      transaction with a per-athlete advisory lock + lookup-first idempotency
--      (ABA-safe) + an atomic trial flip. Mirrors 0022/0023's RPC posture
--      (REVOKE FROM PUBLIC / GRANT EXECUTE TO service_role).
--
-- Scope notes:
-- - NEITHER new table joins supabase_realtime (no calendar surface; the plan
--   renders via the existing plans/planned_workouts realtime). So
--   REALTIME_ALLOWLIST is intentionally NOT touched -- the publication guard
--   only fires on a mismatch, and absence from both sides is the default.
-- - plans gets NO new column: plan-level narrative is not persisted in v1.
-- - delete_user_cascade is extended (a documented exclusion): both new tables
--   carry an athlete/user FK with ON DELETE CASCADE, so the hard account-delete
--   removes them -- the workout_edits precedent (append-only, no deleted_at).

-- ---------------------------------------------------------------------------
-- 1. ai_generation_attempts: idempotency + negative cache
-- ---------------------------------------------------------------------------

CREATE TABLE public.ai_generation_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- Server-generated per request. The (athlete_id, request_id) pair is the
    -- idempotency key: a duplicate delivery / re-submit collapses onto the same
    -- attempt instead of fanning out model spend.
    request_id UUID NOT NULL,
    -- The validated GeneratePlanInput. Lives here (RLS-protected), NEVER in the
    -- Inngest event payload, so injury free-text stays out of Inngest history.
    inputs JSONB NOT NULL,
    requester_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    requester_kind TEXT NOT NULL DEFAULT 'owner'
        CHECK (requester_kind IN ('owner', 'coach')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'succeeded', 'failed', 'infeasible')),
    -- Set on success (ON DELETE SET NULL: a hard-deleted plan leaves the audit
    -- row intact with plan_id NULL).
    plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
    -- Closed-enum failure code (never err.message / prompt / output).
    error_code TEXT,
    failed_at TIMESTAMPTZ,
    -- Negative cache: a fresh re-request (new request_id) is unaffected; only a
    -- replay of THIS request_id is skipped while cooling down.
    cooldown_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ai_generation_attempts_request_unique UNIQUE (athlete_id, request_id)
);

ALTER TABLE public.ai_generation_attempts ENABLE ROW LEVEL SECURITY;

-- Athlete-self SELECT only. No client INSERT/UPDATE/DELETE policies: the row
-- lifecycle is owned exclusively by the service-role worker/RPC. A forged
-- request_id cannot hijack another athlete's generation because the composite
-- key is scoped by auth.uid() = athlete_id here.
CREATE POLICY ai_generation_attempts_self_select ON public.ai_generation_attempts
    FOR SELECT USING (auth.uid() = athlete_id);

-- ---------------------------------------------------------------------------
-- 2. ai_plan_trials: the one-free-plan conversion marker (Unit 7)
-- ---------------------------------------------------------------------------

-- One row per user == the single free trial plan has been consumed. Lowest-
-- surface option: the row's mere existence is the marker, so the RPC flips it
-- with a single INSERT ... ON CONFLICT DO NOTHING that is naturally atomic.
CREATE TABLE public.ai_plan_trials (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The plan the trial minted (audit/telemetry; ON DELETE SET NULL).
    plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL
);

ALTER TABLE public.ai_plan_trials ENABLE ROW LEVEL SECURITY;

-- Athlete-self SELECT so the client can render "trial used". Service-role only
-- for writes (the RPC).
CREATE POLICY ai_plan_trials_self_select ON public.ai_plan_trials
    FOR SELECT USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. create_ai_plan: transactional archive-then-create + idempotency + trial
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER, EXECUTE granted to service_role ONLY (like 0011/0013/0022):
-- the route/worker are the sole authz gate. Returns a typed JSONB outcome:
--   { outcome: 'ok', plan_id, workout_count, idempotent }
--   { outcome: 'raced' }            -- a cross-writer beat us to the one-active slot
--   { outcome: 'trial_exhausted' }  -- the single free plan was already consumed
CREATE OR REPLACE FUNCTION public.create_ai_plan(
    p_athlete_id    UUID,
    p_request_id    UUID,
    p_plan          JSONB,
    p_workouts      JSONB,
    p_consume_trial BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing_plan_id UUID;
    v_new_plan_id      UUID;
    v_workout_count    INT := 0;
    v_trial_inserted   INT := 0;
BEGIN
    -- Serialize all generation for one athlete: closes the TOCTOU window on the
    -- one-active-plan slot and the trial flip without porting app logic into SQL.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_athlete_id::text, 0));

    -- Lookup-first idempotency. A prior SUCCESS for THIS request returns its
    -- plan_id status-agnostically: a plan since archived by a NEWER generation
    -- (the ABA case) must NOT be re-created.
    SELECT plan_id INTO v_existing_plan_id
        FROM public.ai_generation_attempts
        WHERE athlete_id = p_athlete_id
          AND request_id = p_request_id
          AND status = 'succeeded';
    IF v_existing_plan_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'outcome', 'ok', 'plan_id', v_existing_plan_id, 'idempotent', true);
    END IF;

    BEGIN
        -- Atomic trial flip (Unit 7). 0 rows == another request already used the
        -- single free plan under this same lock -> no plan; surfaced as terminal.
        IF p_consume_trial THEN
            INSERT INTO public.ai_plan_trials (user_id, consumed_at)
                VALUES (p_athlete_id, now())
                ON CONFLICT (user_id) DO NOTHING;
            GET DIAGNOSTICS v_trial_inserted = ROW_COUNT;
            IF v_trial_inserted = 0 THEN
                RETURN jsonb_build_object('outcome', 'trial_exhausted');
            END IF;
        END IF;

        -- Archive the current active plan (status + archived_at together to
        -- satisfy plans_archived_at_matches_status).
        UPDATE public.plans
            SET status = 'archived', archived_at = now()
            WHERE athlete_id = p_athlete_id
              AND status = 'active'
              AND deleted_at IS NULL;

        -- Soft-delete the archived plan(s)' not-yet-done workouts in the same
        -- transaction. Calendar reads, the adaptive context, and the detectors
        -- all scope by athlete_id + deleted_at (never plan status), so leaving
        -- these live would double-book the calendar with a dead plan and keep
        -- its rows valid targets for adaptive edit ops. Completed/skipped rows
        -- stay (history); 'moved' rows are superseded pointers, also history.
        UPDATE public.planned_workouts pw
            SET deleted_at = now()
            FROM public.plans p
            WHERE pw.plan_id = p.id
              AND p.athlete_id = p_athlete_id
              AND p.status = 'archived'
              AND pw.deleted_at IS NULL
              AND pw.status = 'planned';

        -- Insert the new active AI plan. created_from_review_id stays NULL.
        INSERT INTO public.plans (athlete_id, status, source, event_type, event_date)
            VALUES (
                p_athlete_id, 'active', 'ai_generated',
                NULLIF(p_plan->>'event_type', ''),
                (p_plan->>'event_date')::date
            )
            RETURNING id INTO v_new_plan_id;

        -- Set-based insert of the workouts. athlete_id + plan_id are derived from
        -- the RPC's own params / the new plan id, NEVER from the workout JSON, so
        -- malformed model output cannot smuggle a cross-athlete id. version
        -- defaults to 1 (the bump trigger is UPDATE-only).
        INSERT INTO public.planned_workouts (
            athlete_id, plan_id, scheduled_date, sport, structure, planned_load,
            status, rationale, edited_by_kind, edited_by_user_id, edited_at
        )
        SELECT
            p_athlete_id,
            v_new_plan_id,
            (w->>'scheduled_date')::date,
            w->>'sport',
            COALESCE(w->'structure', '{}'::jsonb),
            NULLIF(w->>'planned_load', '')::numeric,
            'planned',
            w->>'rationale',
            'ai_review',
            NULL,
            now()
        FROM jsonb_array_elements(p_workouts) AS w;
        GET DIAGNOSTICS v_workout_count = ROW_COUNT;

        -- Mark the attempt succeeded with the new plan id (same transaction).
        UPDATE public.ai_generation_attempts
            SET status = 'succeeded', plan_id = v_new_plan_id
            WHERE athlete_id = p_athlete_id AND request_id = p_request_id;

        IF p_consume_trial THEN
            UPDATE public.ai_plan_trials
                SET plan_id = v_new_plan_id
                WHERE user_id = p_athlete_id;
        END IF;
    EXCEPTION
        WHEN unique_violation THEN
            -- A cross-writer race (e.g. a concurrent coach plan create that did
            -- not take this advisory lock) tripped plans_one_active_per_athlete.
            -- The whole inner block -- archive, insert, AND the trial flip --
            -- rolls back; we surface a typed outcome so the worker tells the
            -- athlete their plan was replaced and to retry. (Other errors, e.g. a
            -- malformed-workout CHECK violation, propagate and roll back the RPC.)
            RETURN jsonb_build_object('outcome', 'raced');
    END;

    RETURN jsonb_build_object(
        'outcome', 'ok',
        'plan_id', v_new_plan_id,
        'workout_count', v_workout_count,
        'idempotent', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_ai_plan(UUID, UUID, JSONB, JSONB, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_ai_plan(UUID, UUID, JSONB, JSONB, BOOLEAN) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. delete_user_cascade: document the new tables' teardown
-- ---------------------------------------------------------------------------
-- Both ai_generation_attempts and ai_plan_trials carry an athlete/user FK with
-- ON DELETE CASCADE and no deleted_at, so the hard account-delete removes them
-- automatically -- the workout_edits precedent. They are intentionally NOT
-- soft-deleted here; this CREATE OR REPLACE only re-states the latest body (0019)
-- plus the documenting comment so a future audit sees the deliberate coverage.
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

    -- workout_edits: intentionally excluded (append-only, no deleted_at);
    -- removed by its athlete_id ON DELETE CASCADE on hard account delete.
    -- ai_generation_attempts / ai_plan_trials: same precedent -- no deleted_at,
    -- removed by their athlete/user ON DELETE CASCADE FKs on hard delete.
    -- admin_audit_log: intentionally excluded (see 0016).

    -- Future tables: extend here in their respective migrations.
END;
$$;
REVOKE ALL ON FUNCTION public.delete_user_cascade(UUID) FROM PUBLIC;
