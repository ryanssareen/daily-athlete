-- Archive and soft-delete RPCs for public.plans, plus their planned_workouts
-- cascade. See:
--   docs/plans/2026-08-15-001-feat-plan-history-archive-delete-plan.md (Unit 1)
--
-- The Supabase REST client has no ad hoc multi-statement transaction
-- primitive, and the plan-row transition (status/deleted_at on `plans`) must
-- be atomic with retiring the plan's not-yet-done `planned_workouts` rows --
-- otherwise a crash between two separate admin-client calls leaves a plan
-- archived/deleted with its workouts still live on the calendar (a ghost).
-- `create_ai_plan` (migration 0024) already establishes this exact cascade
-- when it archives the previous active plan; these two functions extract that
-- cascade into standalone, athlete-initiated operations. Both are single
-- function bodies, which Postgres already executes atomically -- no explicit
-- BEGIN/COMMIT needed.
--
-- SECURITY DEFINER, EXECUTE granted to service_role ONLY (matches
-- create_ai_plan's posture): the calling route is the sole authz gate, and
-- p_athlete_id is always the resolved caller id from that route, never a
-- client-supplied value trusted on its own.
--
-- Both functions return a typed JSONB outcome:
--   { outcome: 'ok', plan: <plans row as JSON> }
--   { outcome: 'not_found' }   -- no row for (p_plan_id, p_athlete_id)

CREATE OR REPLACE FUNCTION public.archive_plan(
    p_athlete_id UUID,
    p_plan_id    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_plan public.plans;
BEGIN
    SELECT * INTO v_plan
        FROM public.plans
        WHERE id = p_plan_id AND athlete_id = p_athlete_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Idempotent no-op: already archived, nothing to cascade again.
    IF v_plan.status = 'archived' THEN
        RETURN jsonb_build_object('outcome', 'ok', 'plan', to_jsonb(v_plan));
    END IF;

    UPDATE public.plans
        SET status = 'archived', archived_at = now()
        WHERE id = p_plan_id AND athlete_id = p_athlete_id
        RETURNING * INTO v_plan;

    -- Retire not-yet-done workouts. Calendar reads and the adaptive engine
    -- scope by athlete_id + deleted_at (never plan status), so leaving these
    -- live would keep a dead plan's schedule on the calendar. Completed/
    -- skipped rows stay (history); 'moved' rows are superseded pointers, also
    -- history.
    UPDATE public.planned_workouts
        SET deleted_at = now()
        WHERE plan_id = p_plan_id
          AND athlete_id = p_athlete_id
          AND status = 'planned'
          AND deleted_at IS NULL;

    RETURN jsonb_build_object('outcome', 'ok', 'plan', to_jsonb(v_plan));
END;
$$;

REVOKE ALL ON FUNCTION public.archive_plan(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_plan(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.soft_delete_plan(
    p_athlete_id UUID,
    p_plan_id    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_plan public.plans;
BEGIN
    -- No deleted_at IS NULL filter here (unlike archive_plan's lookup): an
    -- already-deleted row must still resolve, as a no-op success, rather than
    -- collapsing into the same not_found branch as "never existed"/"not yours".
    SELECT * INTO v_plan
        FROM public.plans
        WHERE id = p_plan_id AND athlete_id = p_athlete_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Idempotent no-op: already deleted, nothing to cascade again.
    IF v_plan.deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'ok', 'plan', to_jsonb(v_plan));
    END IF;

    UPDATE public.plans
        SET deleted_at = now()
        WHERE id = p_plan_id AND athlete_id = p_athlete_id
        RETURNING * INTO v_plan;

    -- Same cascade as archive_plan. Delete can be called directly on an
    -- active plan (no archive step first), so this cascade cannot be skipped
    -- here on the assumption that archive already ran it.
    UPDATE public.planned_workouts
        SET deleted_at = now()
        WHERE plan_id = p_plan_id
          AND athlete_id = p_athlete_id
          AND status = 'planned'
          AND deleted_at IS NULL;

    RETURN jsonb_build_object('outcome', 'ok', 'plan', to_jsonb(v_plan));
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_plan(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_plan(UUID, UUID) TO service_role;
