-- Bootstrap a minimal Supabase-like environment in plain Postgres so all production
-- migrations apply without modification during tests.
--
-- In real Supabase, the auth schema, auth.users, and auth.uid() are provided by Supabase
-- Auth. Here we emulate just enough to satisfy FK targets and RLS expressions.

-- Refuse to bootstrap a non-test database. Catches misconfigured DATABASE_URL pointing
-- at staging/prod — running this would CREATE OR REPLACE auth.uid() with a stub that
-- reads any client-set GUC, granting RLS bypass to any client that can SET
-- request.jwt.claim.sub. The convention: every test DB ends with `_test`.
DO $$
BEGIN
    IF current_database() NOT LIKE '%\_test' ESCAPE '\' THEN
        RAISE EXCEPTION
            'refusing to bootstrap database %: name must end with _test',
            current_database();
    END IF;
END $$;

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

-- Mirror Supabase's role separation in tests so RLS policies are actually
-- exercised (Postgres bypasses RLS for table owners and BYPASSRLS roles —
-- without these non-owner roles, every RLS test passes vacuously).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    END IF;
END $$;

-- The connecting role (the test harness) must be allowed to SET ROLE to these.
DO $$
DECLARE
    me TEXT := current_user;
BEGIN
    EXECUTE format('GRANT anon, authenticated, service_role TO %I', me);
END $$;

-- Grant minimal schema usage so SET ROLE authenticated; SELECT … works.
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO authenticated, service_role, anon;
GRANT SELECT ON auth.users TO authenticated, service_role;
