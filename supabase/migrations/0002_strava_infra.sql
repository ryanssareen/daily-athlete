-- Strava infrastructure: encrypted token storage + raw-payload archive.
--
-- DO NOT ADD `strava_tokens` OR `strava_raw_payloads` TO supabase_realtime publication:
-- both tables contain sensitive material (encrypted tokens, raw OAuth payloads).
-- Writes are service-role only.
--
-- Re-connect contract: when a user re-connects a Strava account already linked to
-- another app user, the OAuth callback handler MUST upsert via:
--   INSERT ... ON CONFLICT (athlete_strava_id) DO UPDATE SET user_id = EXCLUDED.user_id, ...
-- A naive ON CONFLICT (user_id) will hit the strava_tokens_athlete_strava_id_idx
-- unique violation. See the Strava OAuth unit in the implementation plan.

CREATE TABLE public.strava_tokens (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    access_token_enc BYTEA NOT NULL,
    refresh_token_enc BYTEA NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    scope TEXT NOT NULL,
    athlete_strava_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

-- A given Strava athlete should map to exactly one app user (re-connect transfers ownership).
CREATE UNIQUE INDEX strava_tokens_athlete_strava_id_idx
    ON public.strava_tokens (athlete_strava_id);

-- user_id is nullable: webhook events arrive identified by athlete_strava_id and
-- only become user-attributable once the resolver job matches them. Hydration rows
-- always have a user_id (we know which user we're hydrating for).
CREATE TABLE public.strava_raw_payloads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload JSONB NOT NULL,
    arrived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT strava_raw_kind_valid CHECK (kind IN ('webhook', 'hydration')),
    CONSTRAINT strava_raw_user_id_required_for_hydration CHECK (
        kind = 'webhook' OR user_id IS NOT NULL
    )
);

-- Retention sweeper indexes on arrived_at.
CREATE INDEX strava_raw_payloads_arrived_at_idx
    ON public.strava_raw_payloads (arrived_at);

CREATE INDEX strava_raw_payloads_user_idx
    ON public.strava_raw_payloads (user_id);

ALTER TABLE public.strava_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strava_raw_payloads ENABLE ROW LEVEL SECURITY;

-- Self-only read; writes are service-role only (FastAPI handles them).
CREATE POLICY strava_tokens_self_select ON public.strava_tokens
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY strava_raw_payloads_self_select ON public.strava_raw_payloads
    FOR SELECT USING (auth.uid() = user_id);
