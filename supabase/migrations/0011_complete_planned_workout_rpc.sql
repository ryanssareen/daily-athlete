-- Migration 0011: complete_planned_workout RPC
--
-- Provides an atomic path for marking a planned workout as completed.
-- Wraps three DML operations in a single Postgres transaction:
--   1. INSERT into completed_workouts
--   2. INSERT into workout_matches (method='manual_user_link', confidence=1)
--   3. UPDATE planned_workouts.status = 'completed'
--
-- Called from: POST /api/workouts/[id]/status (service-role client)
-- Security: SECURITY DEFINER with restricted search_path; the API layer
-- enforces athlete ownership / linked-coach authorization before calling.
--
-- Parameters follow PostgREST naming convention (p_ prefix) so callers
-- can use .rpc("complete_planned_workout", { p_planned_workout_id: ... }).

CREATE OR REPLACE FUNCTION public.complete_planned_workout(
    p_planned_workout_id UUID,
    p_athlete_id         UUID,
    p_sport              TEXT,
    p_started_at         TIMESTAMPTZ,
    p_duration_s         INTEGER     DEFAULT NULL,
    p_distance_m         NUMERIC     DEFAULT NULL,
    p_source             TEXT        DEFAULT 'manual'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_completed_workout_id UUID;
BEGIN
    -- Step 1: Insert the completed workout.
    INSERT INTO public.completed_workouts (
        athlete_id,
        source,
        started_at,
        sport,
        duration_s,
        distance_m,
        summary_stats
    ) VALUES (
        p_athlete_id,
        p_source,
        p_started_at,
        p_sport,
        p_duration_s,
        p_distance_m,
        '{}'::jsonb
    )
    RETURNING id INTO v_completed_workout_id;

    -- Step 2: Link it to the planned workout.
    INSERT INTO public.workout_matches (
        planned_workout_id,
        completed_workout_id,
        method,
        confidence,
        matched_at
    ) VALUES (
        p_planned_workout_id,
        v_completed_workout_id,
        'manual_user_link',
        1.0,
        now()
    );

    -- Step 3: Mark the planned workout as completed.
    UPDATE public.planned_workouts
    SET    status    = 'completed',
           edited_at = now()
    WHERE  id = p_planned_workout_id;
END;
$$;

-- Grant execute to service_role only (not anon / authenticated).
-- The API layer always uses the service-role admin client for this call.
REVOKE ALL ON FUNCTION public.complete_planned_workout FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.complete_planned_workout TO service_role;
