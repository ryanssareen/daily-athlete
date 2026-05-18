-- Migration 0013: supersede_manual_match RPC
--
-- Provides an atomic path for superseding a manual completion with a Strava
-- completion. Wraps three DML operations in a single Postgres transaction:
--   1. Soft-delete the existing workout_matches row
--   2. Set superseded_by_id on the manual completed_workouts row
--   3. Insert a new workout_matches row for the Strava completed_workouts row
--
-- Called from: matchStravaToPlanned in src/strava/auto-match.ts (service-role)
-- Security: SECURITY DEFINER with restricted search_path; the caller validates
-- athlete ownership and source checks before calling this function.
--
-- planned_workouts.status stays 'completed' — no change needed (R16): the
-- workout was already marked completed by the manual entry; Strava only
-- supersedes the completion record, not the planned status.

CREATE OR REPLACE FUNCTION public.supersede_manual_match(
    p_planned_workout_id           UUID,
    p_old_match_id                 UUID,
    p_manual_completed_workout_id  UUID,
    p_strava_completed_workout_id  UUID,
    p_athlete_id                   UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Step 1: Soft-delete the existing workout_matches row (the manual link).
    UPDATE public.workout_matches
    SET    deleted_at = now()
    WHERE  id = p_old_match_id;

    -- Step 2: Set superseded_by_id on the manual completed_workouts row.
    -- athlete_id guard is belt-and-suspenders given the service-role caller
    -- already validated ownership before invoking this RPC.
    UPDATE public.completed_workouts
    SET    superseded_by_id = p_strava_completed_workout_id
    WHERE  id  = p_manual_completed_workout_id
      AND  athlete_id = p_athlete_id;

    -- Step 3: Insert a new workout_matches row linking the Strava completion.
    INSERT INTO public.workout_matches (
        planned_workout_id,
        completed_workout_id,
        method,
        confidence,
        matched_at
    ) VALUES (
        p_planned_workout_id,
        p_strava_completed_workout_id,
        'merged_from_manual',
        1.0,
        now()
    );

    -- planned_workouts.status stays 'completed' — no UPDATE needed (R16).
END;
$$;

-- Grant execute to service_role only (not anon / authenticated).
REVOKE ALL ON FUNCTION public.supersede_manual_match FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.supersede_manual_match TO service_role;
