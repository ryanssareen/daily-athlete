-- Strava infrastructure: encrypted token storage + raw-payload archive.

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

CREATE TABLE public.strava_raw_payloads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload JSONB NOT NULL,
    arrived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT strava_raw_kind_valid CHECK (kind IN ('webhook', 'hydration'))
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
