-- Bootstrap a minimal Supabase-like environment in plain Postgres so all production
-- migrations apply without modification during tests.
--
-- In real Supabase, the auth schema, auth.users, and auth.uid() are provided by Supabase
-- Auth. Here we emulate just enough to satisfy FK targets and RLS expressions.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY,
    email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Read the current "session user" from a GUC the tests set per request.
-- Mirrors how Supabase's auth.uid() reads from request.jwt.claim.sub.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;
