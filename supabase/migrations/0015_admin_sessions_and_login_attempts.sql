-- Admin dashboard access foundation: server-backed admin sessions + a durable
-- login-attempt store for lockout. Both are SERVICE-ROLE ONLY tables (RLS
-- enabled, NO policies) — the admin dashboard reaches them exclusively through
-- the service-role client (apps/web/src/auth/admin-session.ts), and no
-- athlete/coach client should ever read or write them.
--
-- Plan:   docs/plans/2026-05-21-001-feat-admin-dashboard-plan.md (Unit 1)
-- Origin: docs/brainstorms/2026-05-21-admin-dashboard-requirements.md (R1)
--
-- Conventions (docs/solutions/migration-conventions.md):
-- - Neither table is user-keyed (no FK to public.users), so delete_user_cascade
--   does NOT need to touch them — there is no per-user data to purge here.
-- - Neither table joins supabase_realtime (no realtime allow-list entry).
-- - No now()-dependent index predicates; expiry/window logic is app-layer.

-- ---------------------------------------------------------------------------
-- admin_sessions — revocable, server-backed sessions
-- ---------------------------------------------------------------------------
-- The cookie carries `<id>.<expiresAt>.<hmac>`; this row is the source of
-- truth for revocation and idle timeout. Logout sets revoked_at; rotating
-- ADMIN_PASSWORD revokes all rows. `id` is a 32-byte random hex minted by the
-- app (not gen_random_uuid()) because the app needs it to sign the cookie at
-- insert time.
CREATE TABLE public.admin_sessions (
    id           TEXT PRIMARY KEY,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ
);

-- Scan/prune helper for expired sessions. The cutoff is supplied by the
-- caller, so the index predicate stays now()-free.
CREATE INDEX admin_sessions_expires_at_idx ON public.admin_sessions (expires_at);

ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
-- No policies: only the service-role client (which bypasses RLS) may touch
-- this table. anon/authenticated clients get zero rows and cannot write.

-- ---------------------------------------------------------------------------
-- admin_login_attempts — durable lockout store
-- ---------------------------------------------------------------------------
-- One row per login attempt. Per-IP failure counts over a rolling window
-- drive the primary lockout; a global failure count adds a distributed-attack
-- backoff that never blocks a clean IP (operator self-recovery). Rows are
-- pruned by the app after a retention window.
CREATE TABLE public.admin_login_attempts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip         TEXT NOT NULL,
    success    BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-IP windowed failure count (the hot lockout query).
CREATE INDEX admin_login_attempts_ip_created_idx
    ON public.admin_login_attempts (ip, created_at);
-- Global windowed failure count + retention prune.
CREATE INDEX admin_login_attempts_created_idx
    ON public.admin_login_attempts (created_at);

ALTER TABLE public.admin_login_attempts ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only (same rationale as admin_sessions).
