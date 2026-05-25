-- Transactional apply/reject for AI adaptive proposals. See:
--   docs/plans/2026-05-25-001-feat-ai-adaptive-plans-engine-plan.md (Unit 6)
--
-- apply_weekly_review accepts a subset of op-ids from a proposed weekly_reviews
-- row and applies them atomically: plan-context check, per-op version-staleness
-- check, completed/matched refusal, soft-delete for delete-ops, ai_review
-- attribution, append-only workout_edits audit rows, and the final status
-- transition -- all in one transaction. A failure rolls the whole thing back
-- and leaves status='proposed'.
--
-- Layering (resolves "SQL can't call the TS validator"): the EXPENSIVE
-- CTL/ATL/TSB re-validation (validateOps, Unit 4) runs in Node (apply.ts)
-- immediately BEFORE this RPC; the caller passes only the op-ids that survived
-- re-validation. This RPC then takes FOR UPDATE locks on the active plan and
-- the affected planned_workouts so no new completions/edits can land between
-- the Node re-validation and commit -- closing the load-drift window without
-- porting EWMA math into plpgsql. The RPC owns only the cheap,
-- transaction-local checks below.
--
-- SECURITY DEFINER, EXECUTE granted to service_role ONLY (like 0011/0013): the
-- route handler is the sole authz gate -- it verifies the caller is the
-- proposal's recipient (athlete, or the linked coach for coached athletes)
-- before invoking this via the admin client. p_actor_user_id is the verified
-- accepter, stamped as the editor.
--
-- Returns JSONB: { status, superseded, results: [{op_id, outcome, detail?}] }.
-- outcome in: applied | skipped_stale | refused_completed.
-- (Deselected op-ids simply do not appear in results.)

CREATE OR REPLACE FUNCTION public.apply_weekly_review(
    p_review_id UUID,
    p_accepted_op_ids TEXT[],
    p_actor_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_review        public.weekly_reviews%ROWTYPE;
    v_plan          public.plans%ROWTYPE;
    v_entry         JSONB;
    v_op            JSONB;
    v_baseline      JSONB;
    v_op_id         TEXT;
    v_kind          TEXT;
    v_workout_id    UUID;
    v_base_version  BIGINT;
    v_wk            public.planned_workouts%ROWTYPE;
    v_new_wk_id     UUID;
    v_results       JSONB := '[]'::jsonb;
    v_applied_count INT := 0;
    v_accepted_seen INT := 0;
    v_final_status  TEXT;
    v_changes       JSONB;
    v_new_structure JSONB;
BEGIN
    -- Lock the proposal. Must be open.
    SELECT * INTO v_review FROM public.weekly_reviews
        WHERE id = p_review_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'weekly_review % not found', p_review_id USING ERRCODE = 'no_data_found';
    END IF;
    IF v_review.status <> 'proposed' THEN
        -- Already decided (idempotency / double-apply guard). Surface to caller.
        RETURN jsonb_build_object('status', v_review.status, 'superseded', false,
                                  'results', '[]'::jsonb, 'already_decided', true);
    END IF;

    -- Lock the target plan. Plan-context staleness -> supersede.
    SELECT * INTO v_plan FROM public.plans
        WHERE id = v_review.plan_id FOR UPDATE;
    IF NOT FOUND
       OR v_plan.deleted_at IS NOT NULL
       OR v_plan.status <> 'active'
       OR v_plan.event_date IS DISTINCT FROM v_review.event_date_snapshot THEN
        UPDATE public.weekly_reviews
            SET status = 'superseded', decided_at = now()
            WHERE id = p_review_id;
        RETURN jsonb_build_object('status', 'superseded', 'superseded', true,
                                  'results', '[]'::jsonb);
    END IF;

    -- Apply each accepted op.
    FOR v_entry IN SELECT jsonb_array_elements(v_review.proposed_changes)
    LOOP
        v_op := v_entry->'op';
        v_baseline := v_entry->'baseline';
        v_op_id := v_op->>'op_id';
        v_kind := v_op->>'kind';

        -- Deselected ops are silently not applied.
        CONTINUE WHEN NOT (v_op_id = ANY(p_accepted_op_ids));
        v_accepted_seen := v_accepted_seen + 1;

        IF v_kind = 'insert' THEN
            -- New workout. Fine-grained ISO-week composition staleness is
            -- deferred to the Node re-validation + plan-context check above;
            -- the insert applies here.
            v_changes := COALESCE(v_op->'structure', '{}'::jsonb);
            INSERT INTO public.planned_workouts (
                athlete_id, plan_id, scheduled_date, sport, structure,
                planned_load, status, edited_by_kind, edited_by_user_id, edited_at
            ) VALUES (
                v_review.athlete_id, v_review.plan_id,
                (v_op->>'on_date')::date, v_op->>'sport',
                v_changes - 'load',
                NULLIF(v_changes->>'load', '')::numeric,
                'planned', 'ai_review', p_actor_user_id, now()
            ) RETURNING id INTO v_new_wk_id;

            INSERT INTO public.workout_edits (
                athlete_id, planned_workout_id, weekly_review_id,
                actor_role, actor_user_id, field_diff
            ) VALUES (
                v_review.athlete_id, v_new_wk_id, p_review_id,
                'ai_review', p_actor_user_id, v_op
            );

            v_applied_count := v_applied_count + 1;
            v_results := v_results || jsonb_build_object('op_id', v_op_id, 'outcome', 'applied');
            CONTINUE;
        END IF;

        -- Existing-row ops: move | modify | skip | delete.
        v_workout_id := (v_op->>'workout_id')::uuid;
        v_base_version := (v_baseline->>'version')::bigint;

        SELECT * INTO v_wk FROM public.planned_workouts
            WHERE id = v_workout_id AND athlete_id = v_review.athlete_id FOR UPDATE;

        IF NOT FOUND OR v_wk.deleted_at IS NOT NULL THEN
            v_results := v_results || jsonb_build_object('op_id', v_op_id, 'outcome', 'skipped_stale', 'detail', 'workout missing or deleted');
            CONTINUE;
        END IF;

        -- Version staleness (the authoritative per-op baseline).
        IF v_wk.version IS DISTINCT FROM v_base_version THEN
            v_results := v_results || jsonb_build_object('op_id', v_op_id, 'outcome', 'skipped_stale', 'detail', 'workout changed since proposal');
            CONTINUE;
        END IF;

        -- Refuse ops on work the athlete already did.
        IF v_wk.status = 'completed'
           OR EXISTS (SELECT 1 FROM public.workout_matches m
                      WHERE m.planned_workout_id = v_workout_id AND m.deleted_at IS NULL) THEN
            v_results := v_results || jsonb_build_object('op_id', v_op_id, 'outcome', 'refused_completed');
            CONTINUE;
        END IF;

        IF v_kind = 'move' THEN
            UPDATE public.planned_workouts
                SET scheduled_date = (v_op->>'to_date')::date,
                    edited_by_kind = 'ai_review', edited_by_user_id = p_actor_user_id, edited_at = now()
                WHERE id = v_workout_id;
        ELSIF v_kind = 'modify' THEN
            v_changes := COALESCE(v_op->'changes', '{}'::jsonb);
            -- Merge plannable structure fields; promote `load` to the column.
            v_new_structure := v_wk.structure || (v_changes - 'load');
            UPDATE public.planned_workouts
                SET structure = v_new_structure,
                    planned_load = COALESCE(NULLIF(v_changes->>'load','')::numeric, planned_load),
                    edited_by_kind = 'ai_review', edited_by_user_id = p_actor_user_id, edited_at = now()
                WHERE id = v_workout_id;
        ELSIF v_kind = 'skip' THEN
            UPDATE public.planned_workouts
                SET status = 'skipped',
                    edited_by_kind = 'ai_review', edited_by_user_id = p_actor_user_id, edited_at = now()
                WHERE id = v_workout_id;
        ELSIF v_kind = 'delete' THEN
            -- Soft-delete, never hard-delete (avoids the workout_matches cascade).
            UPDATE public.planned_workouts
                SET deleted_at = now(),
                    edited_by_kind = 'ai_review', edited_by_user_id = p_actor_user_id, edited_at = now()
                WHERE id = v_workout_id;
        ELSE
            RAISE EXCEPTION 'unknown op kind: %', v_kind;
        END IF;

        INSERT INTO public.workout_edits (
            athlete_id, planned_workout_id, weekly_review_id,
            actor_role, actor_user_id, field_diff
        ) VALUES (
            v_review.athlete_id, v_workout_id, p_review_id,
            'ai_review', p_actor_user_id, v_op
        );

        v_applied_count := v_applied_count + 1;
        v_results := v_results || jsonb_build_object('op_id', v_op_id, 'outcome', 'applied');
    END LOOP;

    -- Final status: 'accepted' only if every accepted op actually applied.
    IF v_accepted_seen > 0 AND v_applied_count = v_accepted_seen THEN
        v_final_status := 'accepted';
    ELSE
        v_final_status := 'partially_accepted';
    END IF;

    UPDATE public.plans SET created_from_review_id = p_review_id WHERE id = v_review.plan_id;

    UPDATE public.weekly_reviews
        SET status = v_final_status, decided_at = now()
        WHERE id = p_review_id;

    RETURN jsonb_build_object('status', v_final_status, 'superseded', false, 'results', v_results);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_weekly_review(UUID, TEXT[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_weekly_review(UUID, TEXT[], UUID) TO service_role;

-- Reject: a single status transition, kept as an RPC so weekly_reviews.status
-- is only ever written by SECURITY DEFINER functions (never by a client UPDATE,
-- which RLS forbids). The route verifies recipient authorization first.
CREATE OR REPLACE FUNCTION public.reject_weekly_review(p_review_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
BEGIN
    UPDATE public.weekly_reviews
        SET status = 'rejected', decided_at = now()
        WHERE id = p_review_id AND status = 'proposed'
        RETURNING status INTO v_status;
    IF NOT FOUND THEN
        SELECT status INTO v_status FROM public.weekly_reviews WHERE id = p_review_id;
        RETURN jsonb_build_object('status', COALESCE(v_status, 'not_found'), 'changed', false);
    END IF;
    RETURN jsonb_build_object('status', v_status, 'changed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_weekly_review(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_weekly_review(UUID) TO service_role;
