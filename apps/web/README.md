# DA2 Web — coach app + API

Next.js 15 App Router serves both the coach UI and the API. Server-only code
lives under `src/server/`; route handlers under `app/api/` are thin glue around
those modules.

## Setup

```bash
cp .env.example .env.local
# Fill in the SUPABASE_*, STRAVA_TOKEN_KEYS, CRON_SECRET values. The placeholder
# guard in src/server/config.ts will refuse to boot the server in non-dev with
# any value still empty or marked "replace-with-...".

pnpm install   # from repo root
```

Local Postgres for tests is most easily provided by running the project's
linked Supabase database in `_test` mode (any DB whose name ends with `_test`).
The Vitest harness refuses any other database name.

```bash
pnpm --filter @da2/web dev    # http://localhost:3000
pnpm --filter @da2/web test   # one-shot vitest
pnpm --filter @da2/web typecheck
```

## Layout

```
app/
  layout.tsx                Root layout
  page.tsx                  Marketing landing
  (auth)/sign-in/page.tsx   Email magic-link sign-in
  (coach)/                  Authenticated coach surface
    layout.tsx              Sidebar + auth gate
    roster/page.tsx         Athletes linked to this coach
    athletes/[id]/page.tsx  Per-athlete plan + edit (Phase 4)
  api/                      Route handlers (added in Unit 3)
src/
  auth/supabase.ts          Supabase browser client (client components)
  auth/server.ts            Supabase server client for cookie-bound auth
  api/client.ts             Browser fetch wrapper

  server/                   Server-only modules (NEW in pivot Unit 1)
    config.ts               Zod-validated config + placeholder-secret guard
    supabase.ts             createUserScopedClient + getServiceClient factories
    auth.ts                 jose-based JWKS verifier + bearer extractor
    errors.ts               Typed ApiError + respondError helper
tests/
  setup.ts                  Vitest globalSetup: schema reset + apply migrations
  sql/test_bootstrap.sql    auth-schema stub + non-owner role grants
  helpers/db.ts             withTestDb(client => ...) + asAuthenticated wrapper
  helpers/auth.ts           ES256 keypair + in-process JWKS + token-signer
  server/                   Unit tests for src/server/* modules
```

## How auth-to-DB binding works

The plan calls this out explicitly: the FastAPI/Python predecessor used a
service-role connection plus a manual `SET LOCAL request.jwt.claim.sub`. The
TS port follows the canonical Supabase pattern instead — `createUserScopedClient(jwt)`
builds a client with the anon key + per-request `Authorization: Bearer <jwt>`,
so PostgREST sets `auth.uid()` from the JWT for every query without manual
GUC manipulation. RLS applies as designed.

`getServiceClient()` is reserved for explicit RLS-bypass paths (RevenueCat
webhook, account-deletion cascade). Don't import it from a route handler that
takes user-supplied IDs without explicit `WHERE` filters; `grep` for it
periodically to keep the call set small and auditable.

## How tests authenticate

Tests don't talk to a real Supabase project. Instead `tests/helpers/auth.ts`
mints an ES256 keypair in-memory, serves a one-key JWKS over a tiny in-process
HTTP server, signs tokens locally, and points the verifier at the local JWKS
via `SUPABASE_JWT_JWKS_URL`. This exercises the real `jose` verification path
(no mocks of the verifier itself) end-to-end, no network required.
