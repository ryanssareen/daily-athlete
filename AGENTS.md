# AGENTS.md

Conventions for engineers (human and AI) working in this repo. The bar is: a new contributor or a fresh agent session can do the right thing without reading every file.

## Repo layout

```
apps/
  web/      Next.js 15 App Router — coach + athlete UI AND the API (Route Handlers under app/api/*)
packages/
  shared/   Cross-app TS types + Zod schemas (hand-authored)
daily-athlete/  Flutter — the athlete mobile app (iOS/Android), not part of the pnpm workspace
supabase/
  migrations/  Plain-SQL migrations applied via Supabase CLI
docs/
  brainstorms/  Requirements docs (ce:brainstorm output) — protected
  plans/        Implementation plans (ce:plan output) — protected, contain progress checkboxes
  solutions/    Institutional learnings — protected
infra/        Provisioning runbook (Supabase / Vercel / queue / EAS)
```

The backend is **not** a separate service. All API endpoints, webhooks, and background-job triggers live inside `apps/web` as App Router Route Handlers and run as Vercel serverless functions. There is no Python in this repo.

The `docs/{brainstorms,plans,solutions}/` paths are durable artifacts of the compound-engineering pipeline. **Never** delete or gitignore them.

## RLS posture (read this before writing any user-data query)

RLS is the **primary** authorization defense. Route handlers in `apps/web/app/api/*` create a Supabase client via `@supabase/ssr` that forwards the user's JWT, so every query runs under that user's identity and Postgres enforces RLS policies.

```ts
// right — user JWT, RLS enforces row scoping
const supabase = await createClient();
const { data } = await supabase.from("plans").select("*");

// wrong — service-role bypass without an explicit user filter is a leak
const admin = createServiceClient();
const { data } = await admin.from("plans").select("*");
```

Service-role usage is restricted to:
- Webhook handlers (Strava activity, RevenueCat) where the caller is not the user.
- Scheduled jobs / queue workers that operate on multiple users' rows.
- Admin operations (account deletion cascade, migration scripts).

In every service-role path, queries MUST explicitly filter by user — RLS is not running there. Add a `// service-role: explicit user filter required` comment so reviewers can scan for it.

Caveat on the "right" example above: `@/auth/server`'s `createClient()` forwards the JWT only for **cookie** sessions. Routes that also accept Bearer auth (mobile) via `resolveAuth()` do NOT get that token attached to this client's Postgrest requests — an RLS-scoped write in such a route silently affects zero rows for a Bearer caller instead of erroring. Any route serving both auth surfaces (most of `apps/web/app/api/*`) should use the admin client + explicit `.eq("id"/"user_id", ...)` filter even for a simple self-service write, not just for the three service-role categories above. See `docs/solutions/athlete-timezone-capture.md` for the concrete case this was found in.

Every athlete-data table needs a positive RLS test (own row visible) and a negative one (other user's row hidden). The default is to ship them in the same PR as the defining migration. Plan-driven deferral to a follow-up PR is acceptable when (1) the plan explicitly scopes the RLS tests to a separate unit, (2) the follow-up PR or tracking issue is opened or referenced at merge time, AND (3) the migration PR description calls out the deferral. The tests must land within the same Phase as the defining migration -- never leave an athlete-data table without RLS coverage across a Phase boundary.

## Database & migrations

- Migrations live at `supabase/migrations/NNNN_<imperative_description>.sql`.
- Numbering is **four-digit zero-padded**, starting at `0000` for cross-cutting bootstrap (extensions, helpers).
- One logical change per migration. No monolithic files.
- All timestamp columns are `TIMESTAMPTZ`; all values stored UTC. Athlete timezone lives on `public.users.timezone` and is applied at the read/render boundary.
- **Soft-delete** (`deleted_at TIMESTAMPTZ`) applies to user-authored content the user can delete in normal flow: `completed_workouts`, `planned_workouts`, `plans`, `coach_athlete_links`, `workout_comments`. Subscription/token state changes are NOT soft-delete — use status enums and retention sweeps instead.
- Hard-delete is reserved for the account-deletion cascade.
- Every user-data table gets `ENABLE ROW LEVEL SECURITY` plus at least a SELECT policy. Writes for sensitive tables (`strava_tokens`, `entitlements`, `strava_raw_payloads`) are service-role only — no INSERT/UPDATE/DELETE policies.
- Realtime publication membership is **opt-in per table**. Sensitive surfaces (`strava_tokens`, `entitlements`, `strava_raw_payloads`, `athlete_profiles`) must NEVER join `supabase_realtime`. The allow-list of permitted tables lives at `packages/shared/src/realtime-allowlist.ts` and is enforced by a CI test (`apps/web/src/db/__tests__/realtime-publication.test.ts`). To add a table to realtime: (1) add `ALTER PUBLICATION supabase_realtime ADD TABLE public.<table>;` to a migration AND (2) add the table name to `REALTIME_ALLOWLIST` in the same PR. CI fails on drift in either direction.

## TypeScript (apps/web, packages/shared)

- Strict TS everywhere. Web uses Next.js 15 App Router. The mobile app (`daily-athlete/`) is Flutter/Dart, not TypeScript, and is not part of the pnpm workspace.
- Auth is Supabase magic-link in v1 on web. Apple + Google sign-in providers configured in Supabase dashboard, not code. The Flutter mobile app additionally supports email/password + Apple/Google sign-in — see `docs/operational/ios-release-handoff.md`.
- API code lives at `apps/web/app/api/<resource>/route.ts`. Each handler validates input with a Zod schema from `packages/shared`, instantiates the Supabase client via `@supabase/ssr`, and returns `NextResponse.json(...)`.
- Cross-app types and Zod schemas are hand-authored in `packages/shared`. Web imports from there; the Flutter app does not (no shared codegen across the TS/Dart boundary).
- Lint with ESLint, typecheck with `tsc --noEmit`. Both run in CI.
- `pnpm-lock.yaml` is **tracked** at the repo root. It is the source of truth for reproducible installs — never delete it or add it to `.gitignore`. CI today installs with `pnpm install --frozen-lockfile=false`; tighten to `--frozen-lockfile` once the dependency set stabilises.

## Background jobs

Vercel functions have execution-time limits. Anything long-running (LLM plan generation, Strava backfill of 200 activities, weekly review jobs) goes through the queue layer chosen in Unit 1.5 (default candidate: **Inngest**; alternatives: QStash, Supabase Edge Functions + pg_cron).

Pattern:
- HTTP route enqueues a job with a typed payload, returns `202 Accepted` immediately.
- The queue worker (also a Vercel function or Inngest step) does the slow work, writes results to Postgres, and emits a Realtime event the client listens to.
- Never `await` a long task inside an HTTP handler.

## Running the test suite

`apps/web` DB-integration tests talk to a real local Postgres. Without the local-dev
env exported, ~200 tests fail with `Missing NEXT_PUBLIC_SUPABASE_URL` — that is an
unconfigured shell, **not** a regression. Start the stack (`supabase start`) and export
the keys inline; do not commit an env file:

```bash
eval "$(supabase status -o env \
  --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
  --override-name auth.anon_key=NEXT_PUBLIC_SUPABASE_ANON_KEY \
  --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY | sed 's/^/export /')"
```

There is no jsdom harness anywhere in this repo (`apps/web/vitest.config.ts` is
`environment: "node"`). Component tests therefore exercise exported view-logic
functions, not rendered output — see `app/(athlete)/plan/__tests__/page.test.tsx`.
A UI change is not verified until someone has looked at it in a running app.

## Bearer-token routes

`resolveAuth` (`apps/web/src/auth/bearer.ts`) validates a bearer token via
`supabase.auth.getUser(token)` but does **not** attach it to the client. A client
built by `createClient()` (`@/auth/server`) therefore falls back to the anon key for
subsequent PostgREST queries on a cookie-less request, so `auth.uid()` is NULL and
every RLS-scoped read returns zero rows. The mobile app sends bearer only.

Use `createServerClient()` for auth resolution, then do data access via
`createAdminClient()` with explicit `athlete_id` filters (see
`apps/web/app/api/plans/route.ts`), or attach the token to the data client. Route
tests that mock `@/auth/server` wholesale will not catch this — add a test that
exercises the bearer path with no cookies.

## Repo-relative paths

All paths in docs, plans, brainstorms, and code comments use **repo-relative** form (`apps/web/app/api/strava/route.ts`), never absolute (`/Users/ryan/Documents/da2/...`). Absolute paths break portability across machines and contributors.

## Cross-platform

Every setup instruction in a README must include macOS, Linux, and Windows paths or use a portable installer (`npm -g`, `curl|sh` script). `brew install ...` alone is not acceptable; pair it with the Linux/Windows equivalent.

## Secrets

- Never inline a generated secret into a shell command in a doc. Generate to a 0600 file, set the secret from the file, then `shred` the file.
- Encryption keys live in Vercel env vars and GitHub Actions secrets — never in the repo, never in migrations, never in shell history.
- Strava token encryption uses Node-side AES-256-GCM (Web Crypto / `node:crypto`) inside route handlers — the symmetric key never traverses SQL. Multiple keys are supported via `STRAVA_TOKEN_KEYS=v:hex,v2:hex,...`; the highest version is used for new encryptions, all listed versions are tried for decryption. Each `strava_tokens` row stamps its `key_version` so rotation can be incremental.
- A startup config validator in `apps/web/src/config.ts` refuses to boot with placeholder secrets when `NODE_ENV === "production"`. Every new sensitive setting added here must extend that validator.

## Tooling for agents

When operating in this repo:
- Prefer dedicated tools (Read, Edit, Write) over `cat`/`sed`/`awk`/`echo`.
- Don't suppress errors with `2>/dev/null || true` — fix or report.
- Don't use `&&`/`||`/`;` chains to mask missing prerequisites.
- For broad codebase questions, use the Explore subagent type rather than streaming `grep -r` output.

## Closing a unit

A Wave/Phase implementation unit is "done" when:
- Code is written and tests pass locally (or, if local toolchain is unavailable, syntax/structure checks pass and the unit is committed for CI to verify).
- The plan checkbox is ticked.
- A `docs/solutions/*.md` is added if the unit produced a non-obvious learning. The directory is a searchable knowledge store (flat files, `title`/`date`/`status` frontmatter) — relevant to check when implementing or debugging in an area it already covers.
- Any deferred decision is recorded in the plan's "Deferred to Implementation" section before the next unit starts.

## Compound-engineering workflow

The ce:brainstorm → ce:plan → ce:work → ce:review pipeline is the default. Don't skip stages. ce:review runs on every commit before push (autofix mode is fine; the artifact at `.context/compound-engineering/ce-review/<run-id>/` is durable).
