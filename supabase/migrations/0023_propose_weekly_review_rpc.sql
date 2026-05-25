-- Atomic, serialized insert of a new AI proposal with precedence-based
-- supersede/suppress of any pending plan-scoped proposal. See:
--   docs/plans/2026-05-25-001-feat-ai-adaptive-plans-engine-plan.md (Unit 5)
--
-- WHY AN RPC: supabase-js issues each query as a separate PostgREST HTTP call,
-- so a transaction cannot span SDK calls. The "supersede-then-insert" must be
-- one transaction AND serialized per athlete -- the partial unique index
-- weekly_reviews_one_open_plan_scoped only DETECTS a concurrent collision as
-- 23505 at commit, it does not serialize. This function takes a per-athlete
-- transaction-scoped advisory lock so concurrent triggers for the same athlete
-- run one-at-a-time.
--
-- Precedence (full): B4(event_change) > B2(missed_block) > B5(fatigue_deload) >
-- B1(weekly) > B6(progression_bump) > B7(workout_swap). manual ranks with B1.
-- The priority CASE below mirrors apps/web/src/ai/adaptive/precedence.ts -- keep
-- them in lockstep. Plan-scoped only; workout-scoped (B7) and manual-workout
-- proposals are inserted directly by the engine (exempt from the single-open
-- index) and never call this function.
--
-- Behavior for a plan-scoped incoming proposal when a plan-scoped 'proposed'
-- row already exists for the athlete:
--   incoming priority >= pending  -> supersede the pending row, insert the new
--   incoming priority <  pending   -> suppress: insert nothing, return NULL
-- Returns the new weekly_reviews.id, or NULL when suppressed.
--
-- SECURITY DEFINER, EXECUTE granted to service_role only (the engine calls it
-- via the admin client).

CREATE OR REPLACE FUNCTION public.trigger_priority(p_trigger_kind TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_trigger_kind
        WHEN 'event_change'     THEN 60
        WHEN 'missed_block'     THEN 50
        WHEN 'fatigue_deload'   THEN 40
        WHEN 'weekly'           THEN 30
        WHEN 'manual'           THEN 30
        WHEN 'progression_bump' THEN 20
        WHEN 'workout_swap'     THEN 10
        ELSE 0
    END;
$$;

CREATE OR REPLACE FUNCTION public.propose_weekly_review(
    p_athlete_id UUID,
    p_plan_id UUID,
    p_trigger_kind TEXT,
    p_recipient TEXT,
    p_proposed_changes JSONB,
    p_narrative TEXT,
    p_event_date_snapshot DATE,
    p_earliest_affected_date DATE,
    p_status TEXT DEFAULT 'proposed'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_incoming_priority INT := public.trigger_priority(p_trigger_kind);
    v_pending RECORD;
    v_new_id UUID;
BEGIN
    -- Serialize concurrent re-plans for this athlete.
    PERFORM pg_advisory_xact_lock(hashtext(p_athlete_id::text));

    -- Inspect the current open plan-scoped proposal, if any.
    SELECT id, trigger_kind INTO v_pending
    FROM public.weekly_reviews
    WHERE athlete_id = p_athlete_id
      AND scope = 'plan'
      AND status = 'proposed'
      AND deleted_at IS NULL
    LIMIT 1;

    IF FOUND THEN
        IF v_incoming_priority < public.trigger_priority(v_pending.trigger_kind) THEN
            -- Lower priority than the pending proposal: suppress.
            RETURN NULL;
        END IF;
        -- Higher-or-equal: supersede the pending one in this same transaction.
        UPDATE public.weekly_reviews
            SET status = 'superseded', decided_at = now()
            WHERE id = v_pending.id;
    END IF;

    INSERT INTO public.weekly_reviews (
        athlete_id, plan_id, trigger_kind, scope, recipient, status,
        proposed_changes, narrative, event_date_snapshot, earliest_affected_date
    ) VALUES (
        p_athlete_id, p_plan_id, p_trigger_kind, 'plan', p_recipient, p_status,
        COALESCE(p_proposed_changes, '[]'::jsonb), p_narrative,
        p_event_date_snapshot, p_earliest_affected_date
    ) RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.propose_weekly_review(UUID, UUID, TEXT, TEXT, JSONB, TEXT, DATE, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.propose_weekly_review(UUID, UUID, TEXT, TEXT, JSONB, TEXT, DATE, DATE, TEXT) TO service_role;
