-- Allow one Strava athlete to be linked to MULTIPLE app users at once.
--
-- Previously strava_tokens had a UNIQUE index on athlete_strava_id enforcing a
-- 1:1 athlete->user mapping (the connect route refused cross-user links with
-- HTTP 409). Product decision: permit the same Strava account to connect to
-- multiple app accounts simultaneously (e.g. a personal account + a review/demo
-- account sharing one Strava login).
--
-- Consequence: the webhook resolver now fans out each activity event to EVERY
-- user_id linked to the athlete (see app/api/integrations/strava/webhook), so
-- the same Strava activity is synced into each linked account. The PK on
-- user_id still gives every user its own token row.
--
-- SECURITY NOTE: this intentionally removes the collision guard that prevented
-- linking a Strava account already owned by another app user. Connecting an
-- already-linked Strava account no longer requires owning it. Accepted by the
-- product owner.

-- Drop the unique constraint...
DROP INDEX IF EXISTS public.strava_tokens_athlete_strava_id_idx;

-- ...but keep a NON-unique index so the webhook athlete->users lookup stays fast.
CREATE INDEX IF NOT EXISTS strava_tokens_athlete_strava_id_lookup_idx
    ON public.strava_tokens (athlete_strava_id);
