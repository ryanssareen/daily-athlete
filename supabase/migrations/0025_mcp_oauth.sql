-- MCP connector OAuth 2.1 authorization-server storage + the audit-write
-- policy the connector needs. See:
--   docs/plans/2026-06-27-001-feat-mcp-athlete-stats-connector-plan.md (U3)
--   docs/brainstorms/2026-06-27-mcp-athlete-stats-connector-requirements.md
--
-- ⚠️ UNVERIFIED: this migration was authored against the repo's established
-- conventions (0024/0019) but has NOT yet been applied/tested against a local
-- `supabase start` stack. The U3 RLS suite (positive own-row / negative
-- stranger-row) must be written and run green before this is considered done.
--
-- Four things:
--   1. public.oauth_clients -- Dynamic Client Registration records. NOT
--      user-scoped (a client is Claude registering itself, not an athlete), so
--      no user FK and no cascade. Service-role writes only; RLS enabled with no
--      policies (authenticated has no access; the AS uses service-role).
--   2. public.oauth_authorization_codes -- ephemeral PKCE codes. user_id FK
--      ON DELETE CASCADE; service-role-only writes; RLS enabled, no policies
--      (never read under a user JWT).
--   3. public.oauth_access_tokens -- issued opaque tokens, stored as SHA-256
--      hashes with a family_id for rotation/reuse detection. user_id FK
--      ON DELETE CASCADE; self-SELECT so an athlete can list/revoke their own
--      connector sessions; service-role-only writes.
--   4. workout_edits: add 'agent' to the actor_role CHECK and a self-INSERT
--      RLS policy so connector-originated audit rows can be appended under the
--      athlete's own JWT (0019 created only self/coach SELECT, forcing the
--      service-role admin client -- which the connector must not use, R5).
--
-- Scope notes:
-- - NONE of the new tables join supabase_realtime (no client-subscribed
--   surface; tokens are sensitive). REALTIME_ALLOWLIST is intentionally NOT
--   touched -- the publication guard only fires on a mismatch.
-- - oauth_authorization_codes / oauth_access_tokens carry a user FK with
--   ON DELETE CASCADE and no deleted_at, so the hard account-delete removes
--   them automatically (the workout_edits / ai_generation_attempts precedent).
--   oauth_clients has no user column, so it is correctly out of the cascade.

-- ---------------------------------------------------------------------------
-- 1. oauth_clients: Dynamic Client Registration (RFC 7591) records
-- ---------------------------------------------------------------------------

CREATE TABLE public.oauth_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The issued client_id handed back to the registrant.
    client_id TEXT NOT NULL UNIQUE,
    -- Exact-match redirect URIs (validated HTTPS-or-loopback, no private IPs, at
    -- the /register handler before persistence).
    redirect_uris TEXT[] NOT NULL,
    client_name TEXT,
    -- Full RFC 7591 registration metadata as submitted (audit / future use).
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Registering IP, for the per-IP registration cap (storage-DoS defense).
    registered_ip TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service-role only: registration happens in the AS, never under a user JWT.
-- RLS enabled with NO policies => `authenticated` has zero access; service-role
-- bypasses RLS. Same posture as strava_tokens.
ALTER TABLE public.oauth_clients ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. oauth_authorization_codes: ephemeral PKCE authorization codes
-- ---------------------------------------------------------------------------

CREATE TABLE public.oauth_authorization_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- SHA-256 hash of the issued code (never the plaintext code).
    code_hash TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
    -- The athlete who authorized. CASCADE: account delete removes the code.
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    -- RFC 7636 PKCE: S256 challenge captured at /authorize, verified at /token.
    code_challenge TEXT NOT NULL,
    -- RFC 8707 audience binding: the canonical MCP resource URL.
    resource TEXT NOT NULL,
    scope TEXT,
    -- Single-use: stamped when redeemed at /token; a second redemption is denied.
    consumed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX oauth_authorization_codes_expires_at_idx
    ON public.oauth_authorization_codes (expires_at);

-- Service-role only (ephemeral, never read under a user JWT). RLS enabled, no
-- policies.
ALTER TABLE public.oauth_authorization_codes ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. oauth_access_tokens: issued opaque access/refresh tokens
-- ---------------------------------------------------------------------------

CREATE TABLE public.oauth_access_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- SHA-256 hash of the opaque access token (lookup by hash; never plaintext).
    token_hash TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- Rotation lineage: all tokens minted from one authorization share a family.
    -- A replayed (already-revoked) refresh token revokes the whole family.
    family_id UUID NOT NULL,
    scope TEXT,
    -- RFC 8707 audience binding (canonical MCP URL), re-checked on every call.
    resource TEXT NOT NULL,
    -- Refresh-token material, encrypted at rest (AES-256-GCM, MCP_TOKEN_KEYS).
    -- Stored as bytea via the `\x<hex>` literal conversion (see
    -- docs/solutions/strava-token-crypto.md for the supabase-js BYTEA trap).
    refresh_token_encrypted BYTEA,
    refresh_key_version INT,
    expires_at TIMESTAMPTZ NOT NULL,
    -- Soft-invalidation: rotated/revoked tokens are stamped, never deleted, so a
    -- later replay is detectable (theft signal), not indistinguishable from new.
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX oauth_access_tokens_user_id_idx
    ON public.oauth_access_tokens (user_id);
CREATE INDEX oauth_access_tokens_family_id_idx
    ON public.oauth_access_tokens (family_id);
CREATE INDEX oauth_access_tokens_expires_at_idx
    ON public.oauth_access_tokens (expires_at);

ALTER TABLE public.oauth_access_tokens ENABLE ROW LEVEL SECURITY;

-- Athlete-self SELECT so the connected user can list and revoke their own
-- connector sessions. No client INSERT/UPDATE/DELETE policies: token lifecycle
-- is owned exclusively by the service-role AS. A forged token row cannot be
-- planted by a user, and AE1 holds (a stranger sees zero rows).
CREATE POLICY oauth_access_tokens_self_select ON public.oauth_access_tokens
    FOR SELECT USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. workout_edits: allow agent attribution + self-INSERT under a user JWT
-- ---------------------------------------------------------------------------

-- Add 'agent' so connector-originated edits are attributable distinctly from
-- athlete/coach/ai_review. The constraint is the auto-named inline CHECK from
-- 0019 (workout_edits_actor_role_check).
ALTER TABLE public.workout_edits
    DROP CONSTRAINT workout_edits_actor_role_check;
ALTER TABLE public.workout_edits
    ADD CONSTRAINT workout_edits_actor_role_check
    CHECK (actor_role IN ('athlete', 'coach', 'ai_review', 'agent'));

-- Self-INSERT: 0019 created only self/coach SELECT policies, so appendWorkoutEdit
-- needed the service-role admin client. The connector executes tools under the
-- athlete's own JWT (R5: no service-role in the tool path), so it needs to write
-- its own audit row. Scoped to the caller's own athlete_id.
CREATE POLICY workout_edits_self_insert ON public.workout_edits
    FOR INSERT WITH CHECK (auth.uid() = athlete_id);

-- ---------------------------------------------------------------------------
-- 5. delete_user_cascade: document the new tables' teardown
-- ---------------------------------------------------------------------------
-- oauth_authorization_codes and oauth_access_tokens carry a user_id FK with
-- ON DELETE CASCADE and no deleted_at, so the hard account-delete removes them
-- automatically (the workout_edits / ai_generation_attempts precedent).
-- oauth_clients has no user column and is intentionally NOT cascaded.
-- This CREATE OR REPLACE re-states the latest body (0024) plus the documenting
-- comment so a future audit sees the deliberate coverage.
CREATE OR REPLACE FUNCTION public.delete_user_cascade(user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Soft-delete all coach_athlete_links where the user is the coach side.
    UPDATE public.coach_athlete_links
    SET deleted_at = now(), status = 'archived'
    WHERE coach_user_id = user_id
      AND deleted_at IS NULL;

    -- Soft-delete all coach_athlete_links where the user is the athlete side.
    UPDATE public.coach_athlete_links
    SET deleted_at = now(), status = 'archived'
    WHERE athlete_user_id = user_id
      AND deleted_at IS NULL;

    -- Soft-delete the athlete's AI proposals.
    UPDATE public.weekly_reviews
    SET deleted_at = now()
    WHERE athlete_id = user_id
      AND deleted_at IS NULL;

    -- workout_edits: intentionally excluded (append-only, no deleted_at);
    -- removed by its athlete_id ON DELETE CASCADE on hard account delete.
    -- ai_generation_attempts / ai_plan_trials: same precedent -- no deleted_at,
    -- removed by their athlete/user ON DELETE CASCADE FKs on hard delete.
    -- oauth_authorization_codes / oauth_access_tokens: same precedent -- user_id
    -- ON DELETE CASCADE, no deleted_at; removed on hard delete. oauth_clients
    -- has no user column (global registrations), intentionally not cascaded.
    -- admin_audit_log: intentionally excluded (see 0016).

    -- Future tables: extend here in their respective migrations.
END;
$$;
REVOKE ALL ON FUNCTION public.delete_user_cascade(UUID) FROM PUBLIC;
