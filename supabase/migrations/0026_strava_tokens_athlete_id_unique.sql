-- Restore the UNIQUE index on strava_tokens.athlete_strava_id.
--
-- 0002_strava_infra.sql created this index as UNIQUE, but production had
-- drifted to a non-unique `strava_tokens_athlete_strava_id_lookup_idx`. No
-- migration in this repo drops or replaces it, so the drift was applied
-- out-of-band.
--
-- The drift was not cosmetic. Two rows shared athlete_strava_id 5942428, and
-- the webhook owner lookup in app/api/integrations/strava/webhook/route.ts uses
-- .maybeSingle(), which errors when more than one row matches. The route reads
-- only `data` and ignores `error`, so the lookup returned null and every
-- webhook event for that athlete was silently discarded as `owner_not_found`.
--
-- The application already depends on this constraint existing:
--   - db/strava-tokens.ts upsertStravaToken() names
--     `strava_tokens_athlete_strava_id_idx` as the race arbiter when two
--     callers slip past the findUserByAthleteStravaId pre-check.
--   - strava/errors.ts maps that violation to StravaAccountCollisionError so
--     the connect route returns 409 instead of an unstructured 500.
-- Without the unique index those paths are unreachable and a cross-user
-- collision silently creates a duplicate instead.
--
-- Duplicates must be resolved before this runs; as of this migration the table
-- has none.

CREATE UNIQUE INDEX IF NOT EXISTS strava_tokens_athlete_strava_id_idx
    ON public.strava_tokens (athlete_strava_id);

-- Redundant once the unique index above covers the same column.
DROP INDEX IF EXISTS public.strava_tokens_athlete_strava_id_lookup_idx;
