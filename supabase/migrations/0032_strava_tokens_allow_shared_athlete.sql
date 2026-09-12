-- Allow multiple DA2 users to link the same Strava account.
--
-- 0026_strava_tokens_athlete_id_unique.sql made athlete_strava_id UNIQUE to
-- fix a real incident: duplicate rows made the webhook's .maybeSingle()
-- lookup error out and silently drop every sync event for that athlete.
--
-- Product decision: shared Strava accounts (family, coach testing an
-- athlete's account) are a legitimate case, not just drift -- so the
-- uniqueness requirement is lifted. The webhook route
-- (app/api/integrations/strava/webhook/route.ts) no longer does a
-- single-row lookup; it now selects every row for the athlete_strava_id
-- and fans the event out to each linked user, so removing this
-- constraint does not reintroduce the original silent-drop bug.
--
-- The non-unique index is kept for lookup performance (webhook events
-- and the connect route both filter by athlete_strava_id).

DROP INDEX IF EXISTS public.strava_tokens_athlete_strava_id_idx;

CREATE INDEX IF NOT EXISTS strava_tokens_athlete_strava_id_lookup_idx
    ON public.strava_tokens (athlete_strava_id);
