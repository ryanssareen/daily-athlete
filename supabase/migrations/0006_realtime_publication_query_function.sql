-- Helper function for the realtime-publication CI guard. Returns the set
-- of tables currently in the supabase_realtime publication so the vitest
-- test can compare them against an in-repo allow-list and fail loudly on
-- drift. See:
--   docs/plans/2026-05-12-002-feat-schema-foundation-backfill-plan.md (Unit 5)
--   packages/shared/src/realtime-allowlist.ts
--   apps/web/src/db/__tests__/realtime-publication.test.ts
--   AGENTS.md "RLS posture"
--
-- Service-role only. PostgREST exposes this via .rpc() but only when the
-- caller is authenticated as service_role; no anon access path exists.

CREATE OR REPLACE FUNCTION public.realtime_publication_tables()
RETURNS TABLE(tablename TEXT)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    SELECT t.tablename::TEXT
    FROM pg_publication_tables t
    WHERE t.pubname = 'supabase_realtime'
    ORDER BY t.tablename;
$$;

-- Default function grants include EXECUTE to PUBLIC. Revoke that and
-- explicitly grant only to service_role; the CI guard runs as service-role.
REVOKE EXECUTE ON FUNCTION public.realtime_publication_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.realtime_publication_tables() TO service_role;
