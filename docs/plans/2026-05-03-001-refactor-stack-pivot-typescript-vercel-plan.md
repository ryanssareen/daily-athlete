---
title: "refactor: Stack pivot — port apps/api Python to Next.js TypeScript on Vercel"
type: refactor
status: active
date: 2026-05-03
origin: docs/brainstorms/2026-05-03-stack-pivot-typescript-vercel-requirements.md
deepened: 2026-05-03
---

# Stack Pivot — Python/Fly → Next.js + Supabase + Vercel

## Overview

Convert the Wave-1 Python backend (`apps/api/`, FastAPI + SQLAlchemy + Arq + Fly.io
Dockerfiles) into TypeScript Next.js 15 route handlers inside `apps/web/`, hosted on
Vercel free tier. Preserve every product behavior, every migration, every RLS policy,
every test scenario. Delete the Python toolchain entirely in the same change.

The trigger is the free-tier hosting constraint (origin doc, Problem Frame). The
forcing function for *now* is that the Python codebase is at its lifetime minimum
(~750 src + 400 test lines) before Wave 2 starts; every later week of Wave-2 work
in Python costs ~0.5–1 day of additional migration.

## Problem Frame

See origin: [docs/brainstorms/2026-05-03-stack-pivot-typescript-vercel-requirements.md](../brainstorms/2026-05-03-stack-pivot-typescript-vercel-requirements.md).
The Wave-1 stack relies on a Python service that needs an always-on host. Fly removed
its free tier; Render's free tier has 30s cold starts; Oracle Cloud Always Free is too
ops-heavy for a solo founder. The pivot to Next.js + Supabase + Vercel collapses the
backend into the same TypeScript runtime as the web app, runs entirely on free tiers,
and avoids cold-start dealbreakers.

## Requirements Trace

This plan covers all R1–R16 from the origin document.

| Origin requirement | Implementation Unit |
|---|---|
| R1 (TS backend in `apps/web/app/api/`) | Units 1, 3 |
| R2 (Supabase unchanged) | n/a — preserved by omission |
| R3 (waitUntil/Cron/Edge replaces Arq) | Unit 4 |
| R4 (mobile, schema, RLS, product roadmap unchanged) | All — verified by Unit 8 docs |
| R5–R7 (resumable AI pipeline interface) | Unit 7 |
| R8 (Promptfoo eval harness stays Python in CI) | Unit 6 |
| R9 (Langfuse JS, Anthropic/OpenAI TS SDKs) | Unit 1 (config), Wave 3 implementation |
| R10–R11 (Supabase keepalive + cron budget) | Unit 4 |
| R12 (Strava backfill chunked) | Wave 2 — interface only documented in Unit 7 |
| R13 (Python toolchain fully removed) | Unit 5 |
| R14 (single Node CI pipeline) | Unit 5 |
| R15 (AGENTS.md rewritten) | Unit 8 |
| R16 (token encryption parity) | Unit 2 |

Brought forward from earlier artifacts (product plan + schema plan + ce:review):
- All endpoints (`/health`, `GET /me`, `PATCH /me`, `GET /me/entitlements`) preserve
  the response contract and 401 semantics tested in `apps/api/tests/test_auth.py` and
  `test_users_entitlements.py`.
- The pgcrypto-free Python encryption from ce:review (Fernet, multi-key rotation,
  `key_version` column) is replaced bitwise-incompatibly but functionally equivalent
  in TS. Greenfield → no rows to migrate.
- The placeholder-secret startup guard from ce:review is preserved as a TS validator
  that throws at module load when `app_env in {staging, production}` and a secret
  equals its placeholder.

## Scope Boundaries

Carry forward from origin:
- No change to product behavior, mobile stack, schema, RLS policies, monetization, or
  Wave 2+ feature scope.
- No move away from Supabase. No move to Cloudflare Workers or Convex in v1. No
  half-pivot keeping `apps/api/` for any reason.
- The Wave-3 AI pipeline interface (R5–R7) is captured as types + a docs note —
  not implemented here.

This plan additionally excludes:
- No new product endpoints. Same surface as Wave 1.
- No drizzle / kysely / TypeORM. Direct `supabase-js` + generated types.
- No edge runtime in v1. All API routes target the Node runtime; Edge Functions
  on Supabase only when a future feature actually requires pg_net invocation.
- No data migration. Existing `apps/api/strava_tokens` rows in dev environments
  will not decrypt under the new format — accept re-encrypt on next use.
- No Sentry / Langfuse production wiring. The env-var hooks land in Unit 1; actual
  initialization moves to Wave 2/Wave 3 alongside the features that emit traces.
- No mobile or web UI changes beyond updating the API base URL and any auth
  wiring affected by the runtime move. Routes paths and response shapes preserved.

## Context & Research

### Relevant Code and Patterns

What is being ported:
- `apps/api/src/config.py` — env settings + placeholder-secret guard (~100 LOC + tests)
- `apps/api/src/auth/jwt.py` + `deps.py` — Supabase JWT verifier + bearer-token dependency (~80 LOC + tests)
- `apps/api/src/db/session.py` — async engine + `set_authenticated_user_guc` helper (~80 LOC)
- `apps/api/src/models/*.py` — 4 SQLAlchemy models (User, Entitlement, StravaToken, StravaRawPayload). Replaced by Supabase-generated types.
- `apps/api/src/schemas/*.py` — Pydantic models. Replaced by Zod schemas in `packages/shared/`.
- `apps/api/src/security/token_crypto.py` — Fernet-based encrypt/decrypt with multi-key rotation (~120 LOC + tests).
- `apps/api/src/api/health.py` + `me.py` — 4 endpoints (~80 LOC).
- `apps/api/src/observability/{sentry,langfuse}.py` — env-gated init shims (~40 LOC).
- `apps/api/scripts/check_schema_drift.py` — replaced by Supabase codegen diff in CI.
- `apps/api/tests/conftest.py` + 6 test files — full integration suite (~600 LOC) ported to Vitest.
- `apps/api/tests/sql/test_bootstrap.sql` — auth schema stub. Stays as-is; both old and new test setups use it.

What is being deleted (no replacement):
- `apps/api/Dockerfile`, `Dockerfile.worker`, `fly.toml`
- `apps/api/pyproject.toml`, `apps/api/.python-version`
- All Python toolchain references in `.github/workflows/ci.yml`

What stays untouched:
- `supabase/migrations/0000` through `0003_security_hardening.sql` — the four production migrations.
- `supabase/config.toml`
- `apps/web/` UI code (only `app/api/` is added; existing `app/(coach)/`, `app/(auth)/`, `app/page.tsx` unchanged)
- `apps/mobile/` source (only `.env.example` and `src/api/client.ts` base-URL change)
- All docs in `docs/brainstorms/`, `docs/plans/`, `docs/solutions/`
- `infra/README.md` (rewritten in Unit 8)
- `packages/shared/` — gains `database.types.ts` (codegen output) and Zod schemas

### Institutional Learnings

From `docs/solutions/migration-conventions.md`: migration files are append-only,
numbered `NNNN_*.sql`, and applied in lexicographic order. The pivot does not change
this; the same migrations apply identically.

From the Wave-1 ce:review run artifact at `.context/compound-engineering/ce-review/2026-05-02-001-wave1/summary.md`:
- Bearer parser must reject empty token after the scheme.
- 401 detail must not echo the underlying JWT-decode reason.
- `email` in user response is plain `str | None`, not `EmailStr`.
- Token encryption must reject committed placeholders by exact match plus a length
  floor; substring checks are bypassable.
- Test bootstrap must refuse non-`_test` databases.
- Drift check must refuse non-`_test` databases.

These rules carry forward verbatim into the TS implementation.

### External References

- Vercel route handlers + Fluid Compute: https://vercel.com/docs/functions
- Vercel `waitUntil()`: https://vercel.com/docs/functions/functions-api-reference#waituntil
- Vercel Cron (Hobby = 2 schedules): https://vercel.com/docs/cron-jobs
- Supabase typed client: https://supabase.com/docs/reference/javascript/typescript-support
- Supabase `gen types typescript`: https://supabase.com/docs/guides/api/rest/generating-types
- Node `crypto.subtle` AES-GCM (works in Node + Edge runtimes): https://nodejs.org/api/webcrypto.html
- Vitest setup with Postgres: https://vitest.dev/guide/test-context

## Key Technical Decisions

- **Auth-to-DB binding uses the user's JWT, not a manual `SET LOCAL` GUC.** The Wave-1 Python implementation set `request.jwt.claim.sub` via `set_config(...)` because it connected as a service-role / superuser-equivalent role. The TS port follows the canonical Supabase pattern instead: build a `createUserScopedClient(jwt)` that initializes `supabase-js` with the **anon key + `Authorization: Bearer <jwt>` header**. PostgREST sets `request.jwt.claim.sub` automatically per-request, RLS applies, and there is no shared-connection-leakage risk. A separate `getServiceClient()` exists for explicit RLS-bypass writes (RevenueCat webhook, account-deletion cascade); it is gated behind a server-only import and never reachable from a route handler that touches user-supplied IDs without explicit `WHERE` predicates. **The original GUC-via-SET-LOCAL design was a fatal-class bug in the first draft of this plan; document-review caught it.**
- **`supabase-js` + Supabase-generated TypeScript types as the entire data layer.** No Drizzle / Kysely / TypeORM in v1. Wave 1 has 4 tables and 3 endpoints; an ORM is overhead. Generated `database.types.ts` provides query autocompletion and refactor safety. Migration sync stays in `supabase/migrations/` (single source of truth) — adding Drizzle would create a competing schema source. If query complexity outgrows `supabase-js` ergonomics in Wave 2+, port to Drizzle then; the helper layer added in Unit 1 isolates the swap surface.
- **AES-256-GCM via `node:crypto.subtle` for Strava tokens.** Standard, available in both Node and Edge runtimes, no dependency. Ciphertext format: `<key_version>:<iv_b64>:<ciphertext_b64>:<auth_tag_b64>`. Multi-key rotation via `STRAVA_TOKEN_KEYS="1:hex,2:hex,..."` matches the Python implementation's contract; encryption uses the highest version, decryption picks by version stamp. Greenfield → no Fernet ciphertext to preserve.
- **Vitest + a shared Postgres-fixture pattern that mirrors Python's `conftest.py`.** Drop-database, reapply test bootstrap + migrations once per test file; per-test cleanup via TRUNCATE. The `as_authenticated` role-switching helper carries forward.
- **Schema drift check is codegen-based.** `supabase gen types typescript` writes to `packages/shared/src/database.types.ts`; CI runs the command, then `git diff --exit-code` against the checked-in file. Drift fails the build. Replaces the Python `check_schema_drift.py` with a one-line equivalent.
- **No background-jobs table in Wave 1.** Add it in Wave 2's first feature that emits async work (Strava webhook hydration). For Wave 1's synchronous endpoints, no tracking needed.
- **Mobile API base URL becomes `<host>/api`** (not a separate domain). `apps/mobile/.env.example` updates to `API_URL=http://localhost:3000/api`; production becomes `https://<vercel-domain>/api`. Mobile client paths (`/me`, `/me/entitlements`) are unchanged.
- **CORS is configured via Next.js middleware/headers, not a runtime middleware library.** Vercel auto-handles Vercel-to-Vercel + Vercel-to-Expo origin combinations once the headers are set.
- **Python eval harness lives at repo-root `evals/`, not inside `apps/`.** Owns its own `pyproject.toml` + `uv.lock`. CI job runs only on PRs labeled `eval` and on main. Not deployed to Vercel; not part of the production runtime.
- **Resumable AI pipeline interface is captured as TypeScript types + a `docs/solutions/` design note in this plan.** Implementation lands in Wave 3 against the captured contract. The 300s Vercel ceiling is a non-negotiable constraint; designing for it now is cheaper than discovering it then.
- **Single PR landing.** Per origin R13. Reviewers may sequence locally, but the merge boundary is one PR — no Python lingers in main after the pivot lands.

## Open Questions

### Resolved During Planning

- *ORM*: none — `supabase-js` typed (see Key Decisions).
- *Encryption*: AES-256-GCM in `node:crypto.subtle` (see Key Decisions).
- *Test framework*: Vitest.
- *Schema drift*: Supabase codegen + git diff.
- *Cron schedules*: weekly review + Supabase keepalive (Hobby's 2 slots); retention sweep to `pg_cron`.
- *Eval harness location*: repo-root `evals/` with isolated Python toolchain.
- *Mobile base URL*: `<host>/api` with paths unchanged.
- *Background-jobs table*: deferred to Wave 2.

### Deferred to Implementation

- Exact Vitest fixture API for the per-test transaction-rollback pattern — verify TRUNCATE-on-teardown works the same under Vitest's parallelism model.
- Whether `next.config.ts` needs a `serverComponentsExternalPackages` entry for `@noble/hashes` or any encryption helper that ships ESM-only — discover at first build.
- The exact env-var name pattern for Vercel preview deploys (Supabase URL/anon key per branch vs. shared) — set during Vercel project linking, not in this plan.
- `pg_cron` activation in Supabase free tier — verify availability and quota; if blocked, fall back to a third Vercel cron and accept the budget hit.
- Whether to keep `apps/api/tests/sql/test_bootstrap.sql` at its current path or relocate to `evals/` or `tests/`. Defer until Unit 5 deletion is staged.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Runtime layout after pivot

```
apps/web/                          ← single deployable
├── app/
│   ├── api/                       ← Next.js route handlers (NEW)
│   │   ├── health/route.ts
│   │   ├── me/route.ts                  GET, PATCH
│   │   ├── me/entitlements/route.ts     GET
│   │   ├── cron/keepalive/route.ts      hit by Vercel Cron every 6h
│   │   └── cron/weekly-review/route.ts  hit by Vercel Cron Sundays 18:00 UTC
│   │                                    (no-op stub in Wave 1; wired in Wave 3)
│   ├── (auth)/, (coach)/, ...     ← existing UI (unchanged)
│   └── ...
├── src/
│   ├── server/                    ← server-only code (NEW)
│   │   ├── config.ts                    env validation + placeholder guard
│   │   ├── supabase.ts                  service-role client + per-request user-pinned client
│   │   ├── auth.ts                      JWT verify, current-user helper for route handlers
│   │   ├── crypto/strava.ts             AES-256-GCM token encrypt/decrypt
│   │   └── errors.ts                    typed HTTP errors → JSON response shape
│   ├── auth/, api/, design/       ← existing client code (unchanged)
│   └── ...
└── tests/                         ← Vitest (NEW)
    ├── setup.ts                         schema reset, migration apply, RLS role grants
    ├── helpers/auth.ts                  make_auth_user, as_user, as_authenticated
    ├── api/health.test.ts
    ├── api/me.test.ts
    ├── api/me-entitlements.test.ts
    ├── server/auth.test.ts
    ├── server/config.test.ts
    └── server/crypto-strava.test.ts

evals/                              ← Python eval harness (NEW, CI-only)
├── pyproject.toml
├── promptfoo/
└── README.md

packages/shared/                    ← cross-app types
└── src/
    ├── database.types.ts                ← Supabase codegen (NEW)
    └── index.ts                         existing Zod schemas

apps/api/                           ← DELETED
.github/workflows/ci.yml             ← simplified to Node-only + label-gated Python evals
fly.toml, Dockerfile*               ← DELETED
```

### Request flow (post-pivot)

```
Mobile / Coach Web
    │ Authorization: Bearer <Supabase JWT>
    ▼
Vercel Edge → Next.js Node runtime
    │
    ▼
app/api/<route>/route.ts
    │
    ├── auth.verifyBearer(req)            → SupabaseClaims  (rejects on bad/expired/wrong-iss/wrong-aud)
    │
    ├── createUserScopedClient(jwt)       → supabase-js client
    │     - anon key + Authorization: Bearer <jwt>
    │     - PostgREST sets request.jwt.claim.sub from the JWT per HTTP request
    │     - RLS applies; cross-tenant isolation enforced at the DB
    │
    ├── handler logic — additionally filters by claims.sub for defense in depth
    │
    ├── (rare) getServiceClient()         → supabase-js client with service-role key
    │     - reserved for webhooks / cascades that legitimately bypass RLS
    │     - explicit import path makes accidental use grep-detectable
    │
    ├── waitUntil(...)                    optional fire-and-forget after response
    │
    └── return Response with typed JSON
```

### Strava token ciphertext envelope

```
"<format_version>:<key_version>:<iv_b64url>:<ciphertext_b64url>:<auth_tag_b64url>"

format_version : envelope schema version, currently "1". A parser that does not
                 recognize the format_version MUST fail with a clear error rather
                 than attempt to interpret the remaining fields. This lets future
                 formats coexist with v1 ciphertext during multi-version transitions.
key_version    : which entry in STRAVA_TOKEN_KEYS produced this ciphertext. Positive int.
iv             : 12 random bytes (96-bit GCM IV), urlsafe base64, no padding
ciphertext     : AES-256-GCM(plaintext, key, iv), urlsafe base64, no padding
auth_tag       : 16 bytes, urlsafe base64, no padding
```

Note on Web Crypto API: `crypto.subtle.encrypt(AES-GCM, ...)` returns a single
`ArrayBuffer` containing `ciphertext || auth_tag` concatenated (Web Crypto convention).
Unit 2's encrypt path must slice the trailing 16 bytes off to produce the separate
`auth_tag` segment. The decrypt path concatenates them back before calling
`crypto.subtle.decrypt`.

Stored as `BYTEA` in `strava_tokens.access_token_enc` / `refresh_token_enc` (column
type unchanged from migration 0002). Encoding: UTF-8 bytes of the colon-delimited
string.

### Resumable AI pipeline contract (Wave 3 readiness)

```
plans table additions (DEFERRED to Wave 3 migration):
    generation_state ENUM: pending | block_pending | week_pending | workout_pending | complete | failed
    generation_cursor JSONB: { current_block?: int, current_week?: int, errors?: [...] }
    generated_at, generation_failed_at TIMESTAMPTZ

Functional contract (TS):
    plan_pipeline.advance(plan_id) -> { state: <next_state>, done: bool }
        - reads current generation_state + cursor
        - executes ONE stage (or one fan-out batch within a stage)
        - persists new state + cursor + any new planned_workouts rows
        - returns immediately; never waits for the next stage

Driver:
    POST /api/plans/{id}/generate  → kicks off and waitUntil(advance(plan_id))
    POST /api/plans/{id}/advance   → idempotent; cron-safe
    Vercel Cron daily              → for each plan in non-terminal state, advance() once

Invariants:
    - No single stage exceeds 60s of wall-clock work even with retries
    - Every advance() is idempotent for the same (plan_id, generation_state) input
    - Failure leaves the row in a state that the next advance() can recover from
```

This is captured as a `docs/solutions/ai-pipeline-resumable-design.md` note in Unit 7;
it is NOT implemented in this plan.

## Implementation Units

Phase 0 is a non-coding spike that verifies external assumptions before any unit
ships. Phases A and B form the first PR (port + cleanup). Phase C ships as a
second PR (docs + Wave-3 readiness) so reviewers can scrub functional change
independently of documentation.

---

### Phase 0: Preflight verification (must pass before Unit 1 starts)

- [ ] **Unit 0: Verify external assumptions**

**Goal:** Confirm three external-dependency facts the rest of the plan rests on. If any answer comes back wrong, surface it before writing code, not after.

**Requirements:** prerequisite for R3, R5–R7, R10–R11, all of Phase A.

**Dependencies:** None.

**Files:**
- Create: `docs/solutions/preflight-verification-2026-05.md` (records the verified facts + the date verified + the version of each service / SDK)

**Approach:** Hands-on probes against actual current Supabase + Vercel. Each probe is a single command or a 30-line spike. No code changes to the repo.

1. **`pg_cron` availability on Supabase free tier.** Create a throwaway free Supabase project; run `CREATE EXTENSION IF NOT EXISTS pg_cron;` from the SQL editor. If it errors, retention sweep cannot live in the database — the cron-budget story breaks and Unit 4 must be reshaped (likely by collapsing keepalive + retention-trigger into one Vercel cron endpoint).
2. **JWT signing scheme on a freshly-created Supabase project.** Inspect the project's auth settings + the JWT issued by a test signup. Confirm whether the algorithm is `HS256` (legacy, single shared secret in `SUPABASE_JWT_SECRET`) or `ES256` / `RS256` (asymmetric, with a JWKS endpoint at `/auth/v1/.well-known/jwks.json`). If asymmetric, Unit 1's verifier must use `createRemoteJWKSet` from `jose` instead of a single secret string.
3. **`maxDuration: 300` on Hobby Fluid Compute.** Create a throwaway Vercel Hobby project with a Next.js function that sleeps for 120s with `export const maxDuration = 300`. If Vercel rejects the config or kills the function under 60s, the resumable AI pipeline must use a smaller per-stage budget than the plan currently assumes.
4. **PostgREST GUC propagation via JWT (sanity check on Edit 1).** Sign a test JWT, instantiate `supabase-js` with `Authorization: Bearer <jwt>`, run two sequential `.from(...).select()` calls against an RLS-protected table, and verify each call returns only the JWT-subject's rows. This sanity-checks the Edit-1 architecture before shipping it.

**Test scenarios:**
- Test expectation: none — pure verification spike. The deliverable is the `preflight-verification-2026-05.md` doc with each item marked OK / NOT OK plus the response.

**Verification:** All four items recorded. If any is NOT OK, the plan halts and a revision lands before Unit 1 begins.

---

### Phase A: TS backend parity (the meat of the pivot)

- [ ] **Unit 1: TS server foundation + test harness — first runnable test by end of unit**

**Goal:** Stand up the TypeScript-side equivalents of `apps/api/src/{config,db,auth}/` AND the Vitest+Postgres test harness in the same unit. The test framework is a first-class deliverable, not deferred. By the end of this unit, an implementer can run `pnpm --filter @da2/web vitest run` and see green tests against a real local Postgres with all four migrations applied.

**Requirements:** R1, R9 (env hooks for Sentry/Langfuse), R14 (CI is single Node pipeline starting from this unit).

**Dependencies:** Unit 0 (preflight verified).

**Execution note:** Test-first within the unit. Each helper module ships with its tests in the same commit. Tests must be runnable before any route handler exists — that proves the harness, not just the code.

**Files (all created in this unit, no deferrals):**
- Create: `apps/web/src/server/config.ts`
- Create: `apps/web/src/server/supabase.ts`
- Create: `apps/web/src/server/auth.ts`
- Create: `apps/web/src/server/errors.ts`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/tests/setup.ts` — global setup: drop+recreate test schema, run `tests/sql/test_bootstrap.sql`, apply each `supabase/migrations/*.sql` in lex order via `pg`, verify `auth.users` + `auth.uid()` + role grants exist
- Create: `apps/web/tests/sql/test_bootstrap.sql` — copied bitwise from `apps/api/tests/sql/test_bootstrap.sql` (the role-creation + auth-stub bootstrap; relocated, not redesigned)
- Create: `apps/web/tests/helpers/db.ts` — per-test transaction-rollback or TRUNCATE-on-teardown; mirrors Python `conftest.py::session` fixture
- Create: `apps/web/tests/helpers/auth.ts` — `makeAuthUser(email?, roleFlags?)`, `asUser(uuid)`, `asAuthenticated(uuid)` (the role-switching helper; mirrors Python `as_authenticated`)
- Create: `apps/web/tests/server/config.test.ts`
- Create: `apps/web/tests/server/auth.test.ts`
- Modify: `apps/web/package.json` (deps: `@supabase/supabase-js`, `jose`, `zod`; devDeps: `vitest`, `@vitest/coverage-v8`, `pg`, `@types/pg`; scripts: `test`, `test:watch`)
- Modify: `apps/web/.env.example` (add server-side env: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUD`, `STRAVA_TOKEN_KEYS`, `CRON_SECRET`, `APP_ENV`, `CORS_ORIGINS`, `TRUSTED_HOSTS`)

**Approach:**
- `config.ts` exports `getConfig()`, validated with Zod. Throws `ConfigError` if `app_env in {staging, production}` and any of `SUPABASE_JWT_SECRET`, `SUPABASE_JWT_ISSUER`, `STRAVA_TOKEN_KEYS` (or `STRAVA_TOKEN_KEY`), `TRUSTED_HOSTS`, `CRON_SECRET` are placeholders/empty. **`SUPABASE_JWT_ISSUER` is required in non-dev environments (security finding from review): without it, a cross-project JWT replay is possible if the secret is ever shared between Supabase projects.** Mirrors and extends the Python `Settings._validate_secrets_for_env` from ce:review.
- `supabase.ts` exports `createUserScopedClient(jwt: string)` (anon key + `Authorization` header — RLS applies per request via PostgREST's automatic JWT-claim parsing) and `getServiceClient()` (service-role, RLS bypasses; lives behind a server-only import, used only by webhooks and cascade routines added in later waves). **No `SET LOCAL` GUC manipulation; no transaction wrapping needed.**
- `auth.ts` exports `verifyBearer(request: Request) -> SupabaseClaims`. Uses `jose`. If preflight (Unit 0) found HS256, uses the shared secret. If asymmetric, uses `createRemoteJWKSet`. Required claims `[sub, exp, aud]`. Pins `iss` if configured (forced in non-dev by `config.ts`). Rejects empty bearer tokens. Throws typed errors that `errors.ts` maps to 401 responses with detail `"invalid token"` (no decode-reason leak — ce:review hardening).
- `errors.ts` exports `ApiError` + `respondError(error)`; 401 includes `WWW-Authenticate: Bearer`.
- `tests/setup.ts` is invoked once per test session via `vitest.config.ts`'s `globalSetup`. Refuses to run against a database whose name does not end with `_test` (carries forward the ce:review hardening).
- `tests/helpers/db.ts` provides a `withTestDb(testFn)` wrapper that opens a `pg.Client`, runs the body, TRUNCATEs the user-data tables on exit. Concurrent tests use separate clients; the harness pins `pool: false` to avoid PgBouncer transaction-mode quirks.
- `tests/helpers/auth.ts` provides `asAuthenticated(userId)`: opens a `pg.Client` connected with role `authenticated` (created in `test_bootstrap.sql`), `SET LOCAL request.jwt.claim.sub = <userId>` inside a `BEGIN`/`COMMIT` block, runs the test body, releases. This is the only place `SET LOCAL` is used — within a single explicit transaction, so the GUC is correctly scoped.

**Patterns to follow:**
- Mirror Python's `apps/api/src/config.py`, `apps/api/src/auth/jwt.py`, `apps/api/src/auth/deps.py` for behavior parity. The new file is the implementation; the corresponding Python tests are the parity oracle until they're deleted in Unit 5.
- Mirror `apps/api/tests/conftest.py::session` and `as_authenticated` for the test-harness API.

**Test scenarios:**
- Happy path: valid token with all required claims → `verifyBearer` returns parsed claims.
- Edge case: token missing `aud` → throws.
- Edge case: token missing `iss` when `SUPABASE_JWT_ISSUER` configured → throws.
- Edge case: token with wrong `aud` → throws.
- Edge case: token with wrong `iss` when configured → throws.
- Edge case: token with correct `iss` when configured → succeeds.
- Edge case: empty bearer scheme (`"Bearer "`) → throws.
- Error path: invalid signature → throws; response detail is `"invalid token"`, no decode reason leaked.
- Edge case: `app_env=production` and `SUPABASE_JWT_SECRET="local-jwt-secret-replace-me"` → throws.
- Edge case: `app_env=production` and `SUPABASE_JWT_ISSUER=""` → throws (issuer required in non-dev).
- Edge case: `app_env=production` and `STRAVA_TOKEN_KEYS=""` and `STRAVA_TOKEN_KEY` is the placeholder → throws.
- Edge case: `app_env=production` and `TRUSTED_HOSTS=""` → throws.
- Edge case: `app_env=production` and `CRON_SECRET=""` → throws.
- Happy path: `app_env=production` with all real values → succeeds.
- Integration: `createUserScopedClient(jwtForUserA)` returns only userA's rows from an RLS-protected query (proves PostgREST is propagating the JWT). `createUserScopedClient(jwtForUserB)` returns only userB's rows on the same connection-pool churn — verifies no cross-user leakage.
- Integration: harness boots — `vitest run tests/server/` applies migrations against a fresh `_test` DB and at least one test passes against real Postgres.

**Verification:**
- `pnpm --filter @da2/web vitest run` exits 0 against a fresh `da2_test` database with all four migrations applied.
- `tests/setup.ts` refuses to run against a database whose name does not end with `_test`.
- The harness picks up new migration files automatically (drop in a no-op SQL file under `supabase/migrations/`, rerun, still green).

---

- [ ] **Unit 2: Strava token encryption — AES-256-GCM, multi-key rotation**

**Goal:** TypeScript replacement for `apps/api/src/security/token_crypto.py`. Same multi-key contract via `STRAVA_TOKEN_KEYS`; new ciphertext format incompatible with Python Fernet (greenfield, accepted).

**Requirements:** R16.

**Dependencies:** Unit 1 (`config.ts` for `STRAVA_TOKEN_KEYS`).

**Files:**
- Create: `apps/web/src/server/crypto/strava.ts`
- Create: `apps/web/tests/server/crypto-strava.test.ts`

**Approach:**
- Parse `STRAVA_TOKEN_KEYS = "1:hex,2:hex,..."` once at module load; cache the parsed key map keyed by version.
- `encryptStravaToken(plaintext)` returns `{ ciphertext: string, keyVersion: number }`. Uses the highest configured version. Generates 12-byte IV via `crypto.getRandomValues`, encrypts with AES-256-GCM via `crypto.subtle.encrypt` (which returns `ciphertext || auth_tag` concatenated — slice the trailing 16 bytes to produce the separate envelope segment), packs into the colon-delimited envelope. The envelope's first segment is `format_version` (currently `"1"`), preceding `key_version`.
- `decryptStravaToken(envelope: string)` parses the envelope, rejects unknown `format_version` with a clear error, then looks up the key by `key_version`, concatenates ciphertext+auth_tag back, decrypts. Throws `TokenCryptoError` for unknown version, malformed envelope, or auth-tag failure.
- Reject placeholder values via exact-match against the same constants enforced by `config.ts`. Require a 32-byte key after hex decoding (or after KDF if input is not 64-char hex).
- **Key removal procedure** (documented inline in `crypto/strava.ts` header comment + Unit 7's `docs/solutions/strava-token-encryption.md`): an operator MUST NOT remove a key version from `STRAVA_TOKEN_KEYS` until every `strava_tokens` row referencing that version has been re-encrypted under the current latest. Provide a `pnpm --filter @da2/web exec tsx scripts/rotate-strava-keys.ts` script (added with the first Wave-2 unit that touches strava_tokens, not in this pivot) that walks all rows, decrypts under their stamped version, re-encrypts under the latest, and updates the `key_version` column.

**Patterns to follow:**
- Mirror `apps/api/src/security/token_crypto.py` semantics: multi-version, latest-wins for encrypt, version-keyed for decrypt, `TokenCryptoError` for all failure modes.

**Test scenarios:**
- Happy path: round-trip encrypt → decrypt produces the original plaintext for a 32-byte hex key in `STRAVA_TOKEN_KEYS=1:<64-hex>`.
- Edge case: rotation — encrypt under v1, add v2, encrypt → keyVersion=2; decrypt v1 ciphertext still works.
- Edge case: short key → throws (under 32 bytes after parsing).
- Edge case: placeholder value → throws.
- Error path: tampered ciphertext (flip a byte in the auth-tag segment) → throws.
- Error path: unknown `key_version` on decrypt → throws.
- Edge case: empty `STRAVA_TOKEN_KEYS` and placeholder `STRAVA_TOKEN_KEY` → init throws.
- Edge case: ciphertext envelope is malformed (wrong segment count) → throws with a clear message.

**Verification:** Vitest suite green; the format-incompatibility note is documented in `apps/web/src/server/crypto/strava.ts` header comment + `docs/solutions/strava-token-encryption.md` (created in Unit 7).

---

- [ ] **Unit 3: Route handlers — port `/health`, `/me`, `/me/entitlements`**

**Goal:** Identical HTTP surface to the Python implementation. Same status codes, same response shapes, same RLS-irrelevant-but-GUC-pinned posture.

**Requirements:** R1, R4 (preserve product surface).

**Dependencies:** Unit 1, Unit 2 (for any future endpoint that touches strava_tokens — not the Wave 1 endpoints, but keeps Unit 3 self-contained).

**Files:**
- Create: `apps/web/app/api/health/route.ts`
- Create: `apps/web/app/api/me/route.ts`
- Create: `apps/web/app/api/me/entitlements/route.ts`
- Create: `apps/web/tests/api/health.test.ts`
- Create: `apps/web/tests/api/me.test.ts`
- Create: `apps/web/tests/api/me-entitlements.test.ts`

**Approach:**
- Each route handler: `verifyBearer(req)` → `createUserPinnedClient(claims)` → query → JSON response. The user-pinned client SETS `request.jwt.claim.sub` per request so any DB trigger reading `auth.uid()` sees the right user (matches Python's `set_authenticated_user_guc`).
- Every query that returns user-scoped data has an explicit `WHERE user_id = claims.sub` predicate. RLS is NOT a defense at the API tier — same posture as the Python version (see `AGENTS.md` "RLS posture" section).
- Response shapes match the Pydantic-derived shapes from `apps/api/src/schemas/` exactly: `email` is plain `string | null`, `role_flags` is `string[]`, `created_at` is ISO string. Validate response shapes in tests against the same fixtures.
- 401s use `WWW-Authenticate: Bearer` and detail `"invalid token"` (no JWT-decode reason in the body).

**Patterns to follow:**
- Mirror `apps/api/src/api/health.py` and `apps/api/src/api/me.py` endpoint behavior.
- For PATCH /me, accept `display_name` (1–120 chars) and `timezone` (1–64 chars) — same validation as `apps/api/src/schemas/user.py::UserUpdate`. Use Zod for body parsing.

**Test scenarios:**
- Happy path: `GET /api/health` → `200 {"status": "ok"}` (no auth required).
- Happy path: `GET /api/me` with a valid token for an existing user → returns the user with `email`, `display_name`, `role_flags`, `timezone`, `created_at`.
- Edge case: `GET /api/me` with a soft-deleted user (`deleted_at` set) → 404.
- Error path: `GET /api/me` without bearer → 401 with `WWW-Authenticate: Bearer` and `{"detail": "missing bearer token"}`.
- Error path: `GET /api/me` with malformed token → 401 with `{"detail": "invalid token"}` (no decode reason leakage).
- Happy path: `PATCH /api/me {display_name: "New Name"}` → 200 with updated row.
- Edge case: `PATCH /api/me {display_name: ""}` → 400 (Zod validation rejects).
- Edge case: `PATCH /api/me {display_name: "<121 chars>"}` → 400.
- Happy path: `GET /api/me/entitlements` for a user with one active entitlement → returns `[{entitlement_key, active, expires_at}]`.
- Edge case: `GET /api/me/entitlements` for a user with zero entitlements → `[]`.
- Integration: PATCH followed by GET reflects the change without page reload (proves no stale-cache issue).

**Verification:** `pnpm --filter @da2/web vitest run tests/api/` passes; the response-shape fixtures in `tests/api/me.test.ts` match the corresponding scenarios in `apps/api/tests/test_users_entitlements.py`.

---

- [ ] **Unit 4: Vercel Cron + Supabase keepalive (only one cron schedule in v1)**

**Goal:** Implement Supabase keepalive to defeat the 7-day free-tier auto-pause. Document the cron budget so Wave 2+ engineers don't accidentally exceed Hobby's 2-slot limit. **The weekly-review cron stub from the original draft is dropped — it consumed one of two scarce slots for a no-op. Wave 3's first plan-generation unit creates the schedule and the endpoint together.**

**Requirements:** R3 (waitUntil/Cron substitute for Arq), R10 (keepalive), R11 (cron budget).

**Dependencies:** Unit 0 (preflight verified `pg_cron` availability — if `pg_cron` is unavailable, this unit reshapes), Unit 1, Unit 3.

**Files:**
- Create: `apps/web/app/api/cron/keepalive/route.ts`
- Create: `apps/web/tests/api/cron-keepalive.test.ts`
- Modify: `apps/web/vercel.json` (one cron schedule only: keepalive)
- Modify: `apps/web/.env.example` (`CRON_SECRET` already added in Unit 1; document min entropy requirement here)

**Approach:**
- Keepalive endpoint verifies the `Authorization` header matches `Bearer <CRON_SECRET>` using `crypto.timingSafeEqual` on `Buffer` representations — never `===`. **Timing-safe comparison is mandatory** to prevent secret-prefix discovery via response-latency side-channel (security review finding).
- `CRON_SECRET` must be at least 32 bytes from a CSPRNG (e.g., `openssl rand -base64 32`); `config.ts` validates length in non-dev environments.
- Keepalive executes `select 1` via the service-role client and returns 200. Purpose: defeat Supabase free-tier 7-day auto-pause.
- `vercel.json` declares one schedule: `0 */6 * * *` (every 6 hours).
- The retention sweep for `strava_raw_payloads` runs on `pg_cron` inside Supabase (verified in Unit 0). The migration that wires it up lands in the first Wave-2 unit that touches `strava_raw_payloads` — out of scope for this pivot.

**Patterns to follow:**
- Vercel Cron + `Authorization: Bearer <CRON_SECRET>` (https://vercel.com/docs/cron-jobs#securing-cron-jobs).
- Timing-safe comparison: `crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))` after length check.

**Test scenarios:**
- Happy path: correct secret → 200.
- Error path: missing `Authorization` header → 401.
- Error path: wrong secret of identical length → 401 (proves comparison runs to completion regardless of mismatch position).
- Error path: wrong secret of different length → 401 (length mismatch caught before `timingSafeEqual` to avoid panic).
- Integration: keepalive successfully completes a roundtrip query.

**Verification:** `vercel.json` lists exactly 1 cron schedule; preview deploy attaches it; manual curl with the secret succeeds; without the secret returns 401; rotation procedure is documented in `infra/README.md` (Unit 8).

---

### Phase B: Cleanup — delete Python, simplify CI, update mobile base URL

- [ ] **Unit 5: Excise `apps/api/`, simplify CI, switch schema-drift check to codegen**

**Goal:** Remove the entire Python toolchain and the FastAPI app. Replace the schema-drift check with Supabase codegen + git diff. Mobile base URL switches to `<host>/api`.

**Requirements:** R13, R14.

**Dependencies:** Phase A complete and green.

**Files:**
- Delete: `apps/api/` (entire directory)
- Delete: `Dockerfile`, `Dockerfile.worker`, `fly.toml` references at all paths
- Delete: any references to `apps/api/` in `package.json`, `pnpm-workspace.yaml`, `turbo.json`
- Modify: `.github/workflows/ci.yml` (remove Python job, simplify Node job, add Supabase codegen step)
- Modify: `apps/mobile/.env.example` (`API_URL=http://localhost:3000/api`)
- Modify: `apps/mobile/src/api/client.ts` (verify base-URL handling — likely no code change, only the env value moves)
- Create: `packages/shared/src/database.types.ts` (Supabase codegen output, checked in)
- Modify: `package.json` root scripts: add `db:typegen` script that runs `supabase gen types typescript --local > packages/shared/src/database.types.ts`
- Create: `.github/workflows/evals.yml` (label-gated Python eval harness — set up in Unit 6, but the workflow file lands here so CI structure is complete)

**Approach:**
- CI becomes a single Node job: install pnpm, install deps, run typecheck across workspace, run `pnpm --filter @da2/web lint`, spin up Postgres service, apply migrations via plain `psql` loop (drops dependence on Supabase CLI in CI), run `db:typegen`, fail if `git diff --exit-code packages/shared/src/database.types.ts` shows changes, run Vitest.
- Schema-drift check: the codegen output is the source of truth; if a migration changes a column and the engineer forgets to regenerate, CI fails.
- Mobile base-URL change: only `.env.example` and a one-line update to `apps/mobile/README.md`. The mobile client at `apps/mobile/src/api/client.ts` already builds `${apiUrl}${path}`, so flipping `apiUrl` to `http://localhost:3000/api` makes paths like `/me` resolve correctly without code changes.
- The Python eval harness scaffolding lives in `evals/` (Unit 6) and is gated behind a workflow_dispatch + label trigger; default CI never runs it.

**Patterns to follow:**
- The pre-pivot `.github/workflows/ci.yml` had three jobs: api (Python), web (Node), mobile (Node). After this unit: one job (`ci`) covering all three roles, plus a label-gated `evals` workflow.

**Test scenarios:**
- Test expectation: none — pure deletion + CI restructure. Verified by Phase A's Vitest suite continuing to pass after the deletion, by `pnpm --filter @da2/mobile typecheck` continuing to pass, and by CI completing in a single Node job.

**Verification:**
- `apps/api/` no longer exists.
- `git grep -i "fly\.io\|fastapi\|pydantic\|sqlalchemy"` returns no results in code (excluding docs that reference history).
- CI runs end-to-end on the pivot PR with one job in well under the prior multi-job time.
- `db:typegen` produces the same `database.types.ts` as is checked in (zero drift).

---

**Unit 6 was removed by document-review.** The Python eval-harness sidecar scaffold was rejected as scope creep: it scaffolds for a Wave-3 feature that may choose TS-native Promptfoo, Inspect, or another tool entirely. Origin R8 ("Promptfoo *may* remain in Python") is permission, not a mandate to pre-instantiate. The first Wave-3 unit that wires the eval harness creates `evals/` then. This pivot does not preclude that choice; it just doesn't pre-build it.

---

### Phase C: Wave-3 readiness + final docs (second PR)

- [ ] **Unit 7: AI-pipeline design note + Strava encryption runbook (docs only)**

**Goal:** Capture the contract from origin R5–R7 as a design note Wave 3 must consult, and a Strava-encryption rotation runbook. **No TypeScript types file is shipped — it would almost certainly be rewritten when Wave 3 begins implementing, and a doc satisfies R5–R7 as written.**

**Requirements:** R5, R6, R7, R12, R16 (interface contracts; implementations deferred).

**Dependencies:** Phases A + B merged (so the doc reflects landed reality).

**Files:**
- Create: `docs/solutions/ai-pipeline-resumable-design.md` (durable design note covering the contract, invariants, rationale, and the 300s ceiling as a forcing constraint — with the constraint number cross-referenced to Unit 0's preflight result)
- Create: `docs/solutions/strava-token-encryption.md` (records the AES-GCM ciphertext envelope including `format_version`, multi-key rotation contract, **and the operator runbook for safe key removal**: add new key → deploy → run rotation script → verify zero rows under old key_version → only then remove old key from env)

**Approach:**
- Design note covers: the constraint (300s Vercel Fluid Hobby — verified in Unit 0; if Unit 0 found a tighter ceiling, that number is recorded here instead), the invariants (idempotent `advance` per `(plan_id, state)`, no stage exceeds 60s wall-clock — flagged as ASPIRATIONAL pending Wave 3 measurement, not gospel), the storage shape (deferred to a Wave-3 migration that adds `generation_state` + `generation_cursor` columns to `plans`), and the orchestration model (Vercel `waitUntil` chain + reconciliation cron when added).
- The 60-second-per-stage invariant is explicitly framed as "design target, revisit on measurement" — Wave 3 may need to split stages further or accept streaming-with-progressive-persistence for stages that can't fit (adversarial review finding).
- The Strava-encryption doc captures the format including `format_version` segment, plus the rotation runbook and the explicit operator warning that removing a key version without first re-encrypting referenced rows breaks user Strava integrations silently.

**Patterns to follow:**
- `docs/solutions/migration-conventions.md` shape: title, frontmatter, brief sections.

**Test scenarios:**
- Test expectation: none — pure docs.

**Verification:**
- Both `docs/solutions/` files exist and link from `AGENTS.md` (Unit 8).
- Wave 3 plan reviews can point at the design note as the binding contract.

---

- [ ] **Unit 8: Documentation rewrite — AGENTS.md, README, infra, mobile/web READMEs**

**Goal:** Rewrite every doc that referenced Python, FastAPI, Fly.io, or the previous architecture. After this unit, no agent or human onboarding from `main` is misled by stale instructions.

**Requirements:** R15.

**Dependencies:** Units 1–7 (so the docs reflect actual final state).

**Files:**
- Modify: `AGENTS.md` (additive rewrite — see Approach: delete Python sections, add new TS sections; preserve every ce:review-derived rule verbatim)
- Modify: `README.md` (root — update setup steps, prereqs, "Running locally" section)
- Modify: `infra/README.md` (replace Fly.io / FastAPI sections with Vercel + Supabase deploy steps; document `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_JWT_ISSUER`, `STRAVA_TOKEN_KEYS`, `TRUSTED_HOSTS`, `CORS_ORIGINS` env vars; **document the Vercel preview-deploy posture** — see Approach)
- Modify: `apps/web/README.md` (add a "Backend (API)" section; document the route handlers and where to add new ones)
- Modify: `apps/mobile/README.md` (update `API_URL` value; **add a "Real device development" section** covering LAN-IP / Expo tunnel for accessing the dev API from a physical phone)
- Modify: `docs/plans/2026-05-02-001-feat-ai-endurance-training-app-plan.md` (top-of-file banner: "STACK NOTE (2026-05-03): Stack-specific paragraphs in this plan reference Python/FastAPI; the project pivoted to Next.js TS — see [docs/plans/2026-05-03-001-...](2026-05-03-001-refactor-stack-pivot-typescript-vercel-plan.md). Product-level decisions remain authoritative.")
- Modify: `docs/plans/2026-05-02-002-feat-database-schema-plan.md` (same banner)
- Modify: `docs/solutions/migration-conventions.md` (replace Python drift-check reference with the codegen-based replacement; preserve all migration-naming + soft-delete + UTC + RLS rules verbatim)
- Delete: `apps/api/README.md` (covered by Unit 5)

**Approach:**
- AGENTS.md: delete the Python section; add a "TypeScript (apps/web/)" section covering the Server/Client split, the `src/server/` private boundary, the Vitest pattern, the JWT-via-PostgREST auth-to-DB binding rule (no `SET LOCAL` GUC manipulation), the cron-budget rule, the resumable-AI-pipeline rule. **Preserve the ce:review-derived rules verbatim**: RLS posture (RLS not a defense at the API tier; explicit user_id filters required), soft-delete rule, repo-relative paths policy, secrets-handling rule, compound-engineering workflow rule. Run `git grep` audit before merging this unit to confirm none of those rules were dropped.
- Add to AGENTS.md: a "Background work" section codifying R3 (waitUntil > Cron > Edge Function order of preference; Hobby's 1-cron-slot v1 budget plus the policy that future cron additions must be approved alongside `pg_cron` migration of an existing one; the resumable-pipeline rule with cross-link to `docs/solutions/ai-pipeline-resumable-design.md`).
- README.md root: setup steps drop Python, drop the Docker `docker-compose.yml` requirement (Supabase CLI's `supabase start` becomes the canonical local DB), drop Fly references entirely. Add `pnpm dev` and `pnpm test` as the single commands.
- infra/README.md: rewrite as a 3-step provisioning runbook — Supabase project, Vercel project linking, Vercel env-var configuration. **Add a "Vercel preview deploys" section** documenting the explicit decision: in v1, the project uses production Supabase credentials in preview env, AND we accept this risk only if Vercel "Deployment Protection" is enabled OR a separate Supabase preview project is created. The plan's default is "use a separate Supabase project for previews" because Deployment Protection is a Vercel Pro feature.
- infra/README.md also documents the `CRON_SECRET` rotation procedure (generate via `openssl rand -base64 32` to a temp file, `vercel env add CRON_SECRET production preview`, redeploy, shred file).
- apps/mobile/README.md "Real device development" subsection: in dev, `API_URL` should be set to `http://<dev-machine-LAN-ip>:3000/api` for Expo Go on a physical phone, or use `npx expo start --tunnel` (and update `next dev` to bind `-H 0.0.0.0`). Note that `localhost` only works on simulators / emulators on the same machine.
- Run `git grep -l "apps/api"` across `docs/`; for each remaining hit, decide: leave (historical record) or update. Record decisions in the PR description.

**Patterns to follow:**
- The post-ce:review AGENTS.md is the structural baseline; preserve its tone and rule-density.

**Test scenarios:**
- Test expectation: none — documentation. The smoke test is "a fresh agent / contributor can clone, follow README, and reach a working local dev environment in under 15 minutes".

**Verification:**
- `git grep -E "(fastapi|pydantic|sqlalchemy|fly\.io|FastAPI|Fly\.io)"` returns hits only in `docs/brainstorms/` and `docs/plans/` (historical record), never in `AGENTS.md`, `README.md`, `infra/README.md`, or any active code.
- The Wave 1 ce:review run artifact is preserved (`.context/compound-engineering/ce-review/2026-05-02-001-wave1/`) but its remediation status updated in the new AGENTS.md if needed.

---

## System-Wide Impact

- **Interaction graph:** Mobile + coach web both authenticate via Supabase Auth (unchanged), then call `/api/*` route handlers on the Next.js app (NEW path). The previous separate `apps/api/` deployment is gone. RevenueCat webhook (Wave 5) lands in `apps/web/app/api/webhooks/revenuecat/route.ts` rather than FastAPI. Strava webhook (Wave 2) similarly.
- **Error propagation:** Route handler failures return JSON via `respondError`. `verifyBearer` failures are 401. Validation failures are 400. Internal errors map to 500 without echoing the underlying message. Sentry capture hooks are wired but not initialized in Wave 1; same for Langfuse.
- **State lifecycle risks:** The encryption format change means any `strava_tokens` rows produced by the Python implementation (none in production; possibly some in dev) will fail to decrypt under the new code. Mitigation: documented in `docs/solutions/strava-token-encryption.md`; force a re-encrypt on next Strava reconnect.
- **API surface parity:** `/health`, `GET /me`, `PATCH /me`, `GET /me/entitlements` preserve their request and response shapes exactly. Mobile + web clients are unaffected beyond the base-URL change.
- **Integration coverage:** Vitest fixture spins up Postgres, applies migrations, exercises full request → JWT verify → Supabase query → response paths. RLS is exercised via the `as_authenticated` role-switching helper carried forward from Python tests.
- **Unchanged invariants:** All migrations under `supabase/migrations/`, all RLS policies, the test bootstrap auth-schema stub, the "RLS not a defense at API tier; explicit user_id filters required" rule, the soft-delete posture, the secret-placeholder rejection rule, the encryption-key-rotation contract via `STRAVA_TOKEN_KEYS`.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| TS encryption format breaks dev rows from old code | High | Low | Documented in `docs/solutions/strava-token-encryption.md`; greenfield production has no rows; dev rows re-encrypt on first reconnect. |
| Vitest + Postgres fixture is slower than pytest equivalent and increases CI duration | Med | Low | NullPool-equivalent + per-file schema reset; if duration becomes a problem, switch to per-test SAVEPOINT. |
| Vercel Hobby cron schedule limit (2) cramped before Wave 3 | Med | Med | Documented budget in AGENTS.md; retention sweep moves to `pg_cron`; weekly review fan-out per athlete happens within one cron invocation, not per-athlete schedules. |
| `pg_cron` not available on Supabase free tier | Low | Med | Verify before Wave 2; fallback is a third Vercel cron at the cost of doubling-up keepalive into the retention sweep endpoint. |
| 300s Fluid Compute timeout still too tight for AI plan generation in Wave 3 | Med | High | Resumable-pipeline contract (Unit 7) is the architectural answer; if 60s/stage proves wrong, split stages further. |
| `node:crypto.subtle` API differs subtly between Node 20 and Edge runtime | Low | Low | All API routes target Node runtime in v1 (no `export const runtime = 'edge'`). Reconsider per-route only when a feature demands edge. |
| Schema drift check via codegen produces noisy diffs (e.g., type comments reorder) | Low | Low | Pin Supabase CLI version in CI; commit `database.types.ts` deterministically. |
| Mobile + web clients ship a hardcoded base URL that points at the old API path (`/health` instead of `/api/health`) | Med | Med | Audit `apps/mobile/src/api/client.ts` and `apps/web/src/api/client.ts` in Unit 3; tests in Unit 3 hit the new paths and would catch a stale-base-URL regression. |
| The single-PR landing produces a diff too large to review effectively | Med | Med | Split into two PRs: PR #1 = Phases A+B (functional change), PR #2 = Phase C (docs only). |
| Operator removes a `STRAVA_TOKEN_KEYS` version before re-encrypting referenced rows | Med | High | Key-removal runbook documented in `docs/solutions/strava-token-encryption.md` (Unit 7); explicit operator warning that removal requires running rotation script first; v2-prefix on the envelope so a future format change doesn't worsen this hazard. |
| Vercel preview deploys leak production data via shared service-role key | High (without mitigation) | Critical | Mandatory: separate Supabase project for preview env, scoped Vercel env vars (Production vs Preview). Documented in Operational / Rollout Notes. |
| `CRON_SECRET` leaked, attacker can spam keepalive or trigger cron endpoints | Med | Med | Timing-safe comparison required (Unit 4); rotation procedure documented (Unit 8); future cron endpoints with side effects (Wave 3+) must include rate limiting alongside the secret check. |
| Pivot exceeds the revised 5–7 day estimate | Med | High | Time-box at 7 working days. If exceeded, halt and reassess against "stay on Python and pay $7/mo." Captured in Strategic Risks. |

## Alternative Approaches Considered

The following alternatives were considered and rejected. They are recorded so the decision is auditable and so a future reviewer doesn't re-litigate them silently.

- **Stay on Python; pay $7/mo on Render or $5/mo on Hetzner.** The brainstorm itself acknowledges: "if a paying customer commits within 30 days, the answer flips to stay on Python." Annual cost: $60–84. Annual saved: 2–4 days of pivot work × the founder's effective hourly value, plus the unknown carrying cost of porting future Wave-2 work in Python. **Rejected because:** the founder has explicitly named "free" as a hard constraint; staying on Python and paying is a different product economics decision that hasn't been made yet. **Reconsider if:** a paying customer commits, OR the pivot exceeds the revised estimate (5–7 days), at which point staying-and-paying may be cheaper than completing the pivot.
- **Cloudflare Workers + Hyperdrive-to-Supabase for the API layer.** Generous free tier (100k requests/day), 30s CPU per request, free Cron Triggers. Same TypeScript pivot, different host. **Rejected because:** introduces a third runtime alongside Vercel + Supabase; Hobby Vercel + free Supabase covers v1 needs; Workers becomes credible only if Vercel's Hobby ceiling becomes binding.
- **Hybrid — Next.js on Vercel + Python API on Oracle Cloud Always Free (4 ARM cores, 24 GB RAM).** Truly free, no auto-pause, no cold starts. Keeps Python ecosystem entirely. **Rejected because:** ops burden (deploys, monitoring, OS patching, backups) on a solo founder is net negative; the Python ecosystem advantages (DSPy, Inspect) are concentrated in Wave 3, not Wave 1; if Wave 3 needs Python, extracting an ML sidecar at that point is cheaper than running ops now.
- **Stay on Python, host on Cloudflare Containers / Koyeb / Railway free tier.** Free tiers exist but have similar cold-start or auto-suspend properties to Render. **Rejected because:** they re-introduce the same dealbreaker that triggered the pivot.
- **Convex as the entire backend, replacing Supabase.** TS-first reactive backend. **Rejected because:** loses the Supabase Auth + Realtime + Postgres-RLS investment already in the schema; raises lock-in significantly more than the proposed pivot.

## Strategic Risks

These are risks at the *product* level rather than the technical implementation level. They survive even after the technical risk table mitigations land.

| Strategic risk | Why it matters | Response |
|---|---|---|
| Pivot ships, no product launches | $0 hosting achieved, $0 product value created. The pivot only matters if the project itself stays alive. | Time-box the pivot to 7 working days. If exceeded, halt and reassess against "stay on Python and pay." |
| Vercel Hobby tightens free-tier terms in Q3 2026 | The original trigger was Fly removing a free tier. Same vendor-pull-the-rug risk applies to Vercel. | Document the Cloudflare Workers fallback in `infra/README.md` (Unit 8). Code is portable: Next.js runs on Cloudflare Pages too. |
| Wave-3 AI quality bar (≥80% eval pass) is harder to maintain in TS than Python | Product wedge depends on AI plan quality. Eval-iteration loop crosses a language boundary if Promptfoo lives in Python sidecar. | If Wave-3 quality work proves bottlenecked by language friction, extract a Python AI worker as a dedicated service (Cloudflare Workers via Pyodide or a $4/mo Hetzner VM). The cost is low because the resumable-pipeline contract (Unit 7) keeps the interface clean. |
| Founder runs out of energy/runway during the pivot | Biggest single risk for solo-founder work. Half-pivoted state is worse than no pivot. | Phase A + B is the first PR. Phase C is a separate, cheap PR (docs only). If only Phase A merges and the founder pauses, the repo is in a recoverable state — Python is still there. |
| Pivot quietly shifts brand from "AI training company" to "TS SaaS shop" | Stack reads to external observers (potential coaches, partners, hires) as a generic SaaS app rather than an AI-engineering product. | Accepted tradeoff in v1 (athletes don't see the stack; founder is solo so no hiring). Worth revisiting if/when the product becomes externally visible at the engineering level. |

## Phased Delivery

- **Phase 0 (Unit 0): Preflight verification.** Two hours of probing against fresh Supabase + Vercel projects. Outcome: a `docs/solutions/preflight-verification-2026-05.md` recording verified assumptions or surfacing blockers.
- **Phase A (Units 1–4): TS backend parity.** Lands in PR #1 as 4 sequential commits. After A, the new TS API serves identical traffic to the old Python API. **Both stacks coexist briefly inside this PR** so reviewers can compare; deletion happens in the same PR via Phase B.
- **Phase B (Unit 5): Cleanup.** Same PR as Phase A. After PR #1 merges, Python is gone, CI is one Node job, schema-types are checked in.
- **Phase C (Units 7–8): Wave-3 readiness + docs.** **Lands in PR #2.** Documentation-only changes plus the `docs/solutions/` design notes. Cheap to review independently. Splitting Phase C off PR #1 reduces the merge-burden risk flagged in the document review.

**Why split into two PRs (revised from the original "single PR" stance):** The original draft argued single-PR for "no half-pivot" purity. Document review correctly flagged that an 8-commit single PR with cross-cutting deletion is hard to review even with commit-by-commit scrubbing, and that documentation-only changes have no functional dependency on landing simultaneously with the code. The "no half-pivot" rule is preserved by having Phase B (Python deletion) inside PR #1; what gets split off is just the docs and the Wave-3 design note.

## Migration Effort (Revised Estimate)

The original draft estimated **2–4 working days**. Document review revised this upward; the original number was anchored on LOC-count alone and ignored provisioning, environmental setup, fixture authoring, and probability-weighted cost of preflight findings.

- **Phase 0 (Unit 0):** preflight probes against fresh Supabase + Vercel — half a day.
- **Phase A — Units 1–4:** TS server foundation + tests + crypto + route handlers + cron. ~3 working days. Unit 1 alone is ~1 day because the test harness is now first-class (vitest config, setup, helpers, role-grant SQL, migration applier).
- **Phase B — Unit 5:** delete `apps/api/`, simplify CI, switch drift check to codegen, mobile base URL, snapshot-parity capture (see below). ~1 day.
- **Phase C — Units 7–8 (second PR):** docs + design notes. ~1 day.
- **Revised total: 5–7 working days end-to-end** (Phase 0 + Phase A + Phase B in PR #1; Phase C in PR #2).

If actual elapsed time exceeds 7 working days, halt the pivot and reassess against the "stay on Python + pay $7/mo" alternative captured under Alternative Approaches.

### Snapshot-parity discipline (added to Unit 5)

Before deleting `apps/api/`, run the Python test suite once and capture the exact JSON response shapes from `GET /me`, `PATCH /me`, `GET /me/entitlements`, `GET /health` into JSON snapshot files under `apps/web/tests/fixtures/python-parity/`. The TS test suite asserts each route's response matches the corresponding snapshot byte-for-byte (modulo timestamps and other intentionally-fluid fields documented in `python-parity/README.md`). This proves parity rather than claiming it — the original "response shapes match exactly" assertion was untestable once the Python tests are deleted in the same PR.

### Dev-DB cleanup checklist (added to Unit 5)

Before merging Phase B, the engineer runs `psql "$DATABASE_URL_TEST_SYNC" -c "TRUNCATE public.strava_tokens, public.strava_raw_payloads"` against the local dev DB to remove any rows encrypted under the old Python Fernet format. Otherwise, the first time the engineer runs the new test suite locally, decryption-failed errors confuse rather than illuminate. Add this step to `apps/api/README.md` (still present at this point in the PR) as a one-line "post-pivot dev step."

## Documentation Plan

- `AGENTS.md` (rewritten in Unit 8) — the single canonical reference for any future agent.
- `docs/solutions/ai-pipeline-resumable-design.md` (Unit 7) — Wave 3 binding contract.
- `docs/solutions/strava-token-encryption.md` (Unit 7) — ciphertext format + rotation runbook.
- `docs/solutions/migration-conventions.md` — minor update in Unit 8 noting the codegen-based drift check.
- `docs/plans/2026-05-02-001-...md` and `2026-05-02-002-...md` — left untouched as historical record; the Wave 2 unit boundaries described there are still valid product-wise but their stack-specific paragraphs (FastAPI handlers, Pydantic schemas) become aspirational under the new stack. A short banner in each plan pointing to this pivot doc is added in Unit 8.

## Operational / Rollout Notes

- Vercel project must be created and linked to the GitHub repo before this PR merges; preview deploys on the PR are part of the verification.
- **Vercel preview-deploy posture (security):** the original draft instructed setting `SUPABASE_SERVICE_ROLE_KEY` in both production AND preview environments. Document review flagged this as a critical leak path: every PR preview URL is then a publicly-reachable, fully-RLS-bypass-capable backdoor. **Required mitigation before the first preview deploy lands:** create a **separate Supabase project for previews/staging** with its own service-role key and JWT secret. Vercel env-var scoping puts the production keys in `Production` only and the preview keys in `Preview`. (Vercel "Deployment Protection" — password-protect previews — is a Pro-tier feature; if upgrading to Pro is acceptable, that's an alternative mitigation. On Hobby, the separate-Supabase-project approach is the only free path.)
- Supabase production project must exist with all four migrations applied. The same migrations apply to the preview Supabase project. `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, and `SUPABASE_JWT_ISSUER` must be set distinctly per Vercel environment.
- `CRON_SECRET` must be set (production + preview, distinct values) before the first cron run; otherwise keepalive returns 401 and Supabase will pause after 7 days. Generate via `openssl rand -base64 32`. Rotate procedure documented in `infra/README.md` (Unit 8).
- Mobile app's `API_URL` must be updated in Expo's EAS env (production builds) and `.env` (local dev) at the same time as this PR — coordinated change, not a follow-up. Real-device development requires LAN-IP or Expo tunnel, not `localhost` — see `apps/mobile/README.md` for the dev-loop instructions.
- Production cutover is merging PR #1 to `main`. Preview deploys with the separate Supabase project serve as staging.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-03-stack-pivot-typescript-vercel-requirements.md](../brainstorms/2026-05-03-stack-pivot-typescript-vercel-requirements.md)
- **Earlier product brainstorm:** [docs/brainstorms/2026-05-02-ai-endurance-training-app-requirements.md](../brainstorms/2026-05-02-ai-endurance-training-app-requirements.md)
- **Earlier schema brainstorm:** [docs/brainstorms/2026-05-02-database-schema-requirements.md](../brainstorms/2026-05-02-database-schema-requirements.md)
- **Earlier product plan:** [docs/plans/2026-05-02-001-feat-ai-endurance-training-app-plan.md](2026-05-02-001-feat-ai-endurance-training-app-plan.md)
- **Earlier schema plan:** [docs/plans/2026-05-02-002-feat-database-schema-plan.md](2026-05-02-002-feat-database-schema-plan.md)
- **Wave 1 ce:review run artifact:** [.context/compound-engineering/ce-review/2026-05-02-001-wave1/summary.md](../../.context/compound-engineering/ce-review/2026-05-02-001-wave1/summary.md)
- External: Vercel Fluid Compute, Vercel Cron, Supabase typed client, `node:crypto.subtle` AES-GCM, Vitest (URLs in Context & Research).
