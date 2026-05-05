# AGENTS.md

Conventions for engineers (human and AI) working in this repo. The bar is: a new contributor or a fresh agent session can do the right thing without reading every file.

## Repo layout

```
apps/
  mobile/   Expo + React Native (athlete app)
  web/      Next.js 15 App Router — coach + athlete UI AND the API (Route Handlers under app/api/*)
packages/
  shared/   Cross-app TS types + Zod schemas (hand-authored)
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

Every athlete-data table needs a positive RLS test (own row visible) and a negative one (other user's row hidden) before its defining migration ships.

## Database & migrations

- Migrations live at `supabase/migrations/NNNN_<imperative_description>.sql`.
- Numbering is **four-digit zero-padded**, starting at `0000` for cross-cutting bootstrap (extensions, helpers).
- One logical change per migration. No monolithic files.
- All timestamp columns are `TIMESTAMPTZ`; all values stored UTC. Athlete timezone lives on `public.users.timezone` and is applied at the read/render boundary.
- **Soft-delete** (`deleted_at TIMESTAMPTZ`) applies to user-authored content the user can delete in normal flow: `completed_workouts`, `planned_workouts`, `plans`, `coach_athlete_links`, `workout_comments`. Subscription/token state changes are NOT soft-delete — use status enums and retention sweeps instead.
- Hard-delete is reserved for the account-deletion cascade.
- Every user-data table gets `ENABLE ROW LEVEL SECURITY` plus at least a SELECT policy. Writes for sensitive tables (`strava_tokens`, `entitlements`, `strava_raw_payloads`) are service-role only — no INSERT/UPDATE/DELETE policies.
- Realtime publication membership is **opt-in per table**. Sensitive surfaces (`strava_tokens`, `entitlements`, `strava_raw_payloads`) must NEVER join `supabase_realtime`. Add a comment in any migration that touches a sensitive table noting the exclusion.

## TypeScript (apps/web, apps/mobile, packages/shared)

- Strict TS everywhere. Web uses Next.js 15 App Router; mobile uses Expo Router.
- Auth is Supabase magic-link in v1. Apple + Google sign-in providers configured in Supabase dashboard, not code.
- API code lives at `apps/web/app/api/<resource>/route.ts`. Each handler validates input with a Zod schema from `packages/shared`, instantiates the Supabase client via `@supabase/ssr`, and returns `NextResponse.json(...)`.
- Cross-app types and Zod schemas are hand-authored in `packages/shared`. Mobile and web both import from there. There is no codegen step.
- Lint with ESLint, typecheck with `tsc --noEmit`. Both run in CI.

## Background jobs

Vercel functions have execution-time limits. Anything long-running (LLM plan generation, Strava backfill of 200 activities, weekly review jobs) goes through the queue layer chosen in Unit 1.5 (default candidate: **Inngest**; alternatives: QStash, Supabase Edge Functions + pg_cron).

Pattern:
- HTTP route enqueues a job with a typed payload, returns `202 Accepted` immediately.
- The queue worker (also a Vercel function or Inngest step) does the slow work, writes results to Postgres, and emits a Realtime event the client listens to.
- Never `await` a long task inside an HTTP handler.

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
- A `docs/solutions/*.md` is added if the unit produced a non-obvious learning.
- Any deferred decision is recorded in the plan's "Deferred to Implementation" section before the next unit starts.

## Compound-engineering workflow

The ce:brainstorm → ce:plan → ce:work → ce:review pipeline is the default. Don't skip stages. ce:review runs on every commit before push (autofix mode is fine; the artifact at `.context/compound-engineering/ce-review/<run-id>/` is durable).
