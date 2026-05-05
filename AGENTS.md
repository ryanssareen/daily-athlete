# AGENTS.md

Conventions for engineers (human and AI) working in this repo. The bar is: a new contributor or a fresh agent session can do the right thing without reading every file.

## Repo layout

```
apps/
  api/      FastAPI + SQLAlchemy 2.x async + Pydantic v2 (Python 3.13)
  mobile/   Expo + React Native (athlete-facing)
  web/      Next.js 15 App Router (coach-facing)
packages/
  shared/   Cross-app TS types — generated from Pydantic via apps/api/scripts/generate_shared_schemas.py (Wave 2+)
supabase/
  migrations/  Plain-SQL migrations applied via Supabase CLI
docs/
  brainstorms/  Requirements docs (ce:brainstorm output) — protected
  plans/        Implementation plans (ce:plan output) — protected, contain progress checkboxes
  solutions/    Institutional learnings — protected
infra/        Provisioning runbook (Supabase / Fly.io / Vercel / EAS)
```

The `docs/{brainstorms,plans,solutions}/` paths are durable artifacts of the compound-engineering pipeline. **Never** delete or gitignore them.

## RLS posture (read this before writing any user-data query)

The FastAPI server runs with credentials that bypass RLS (schema owner in dev;
`service_role` in prod). **RLS is therefore not a defense at the API tier.**
Every query that returns user-scoped rows MUST filter by the authenticated user
explicitly:

```python
# right
await session.execute(select(Plan).where(Plan.athlete_id == claims.sub))

# wrong — relies on RLS that doesn't apply
await session.execute(select(Plan))
```

RLS exists to protect direct-from-client paths (Supabase JS with the anon key,
Realtime subscriptions, future PostgREST endpoints). Tests verify policies via
the `as_authenticated` fixture which `SET ROLE authenticated` to a non-owner
role that DOES respect RLS — every athlete-data table needs a positive RLS
test (own row visible) and a negative one (other user's row hidden) before its
defining migration ships.

The per-request session also pins `request.jwt.claim.sub` via
`set_authenticated_user_guc()` so that any database trigger that reads
`auth.uid()` sees the right user.

## Database & migrations

- Migrations live at `supabase/migrations/NNNN_<imperative_description>.sql`.
- Numbering is **four-digit zero-padded**, starting at `0000` for cross-cutting bootstrap (extensions, helpers).
- One logical change per migration. No monolithic files.
- All timestamp columns are `TIMESTAMPTZ`; all values stored UTC. Athlete timezone lives on `public.users.timezone` and is applied at the read/render boundary.
- **Soft-delete** (`deleted_at TIMESTAMPTZ`) applies to user-authored content the user can delete in normal flow: `completed_workouts`, `planned_workouts`, `plans`, `coach_athlete_links`, `workout_comments`. Subscription/token state changes are NOT soft-delete — use status enums and retention sweeps instead.
- Hard-delete is reserved for the account-deletion cascade.
- Every user-data table gets `ENABLE ROW LEVEL SECURITY` plus at least a SELECT policy. Writes for sensitive tables (`strava_tokens`, `entitlements`, `strava_raw_payloads`) are service-role only — no INSERT/UPDATE/DELETE policies.
- Realtime publication membership is **opt-in per table**. Sensitive surfaces (`strava_tokens`, `entitlements`, `strava_raw_payloads`) must NEVER join `supabase_realtime`. Add a comment in any migration that touches a sensitive table noting the exclusion.
- Drift check (`apps/api/scripts/check_schema_drift.py`) runs in CI on every PR and refuses to proceed against a database whose name does not end with `_test`.

## Python (apps/api/)

- Python 3.13. Managed via `uv`.
- FastAPI for HTTP, SQLAlchemy 2.x async + Pydantic v2 for persistence, Arq + Redis for jobs.
- Lint with `ruff`, typecheck with `mypy --strict`. Both run in CI.
- Pydantic models live in `src/schemas/`; SQLAlchemy ORM in `src/models/`. Don't conflate them.
- pytest with `asyncio_mode=auto` — do NOT add `@pytest.mark.asyncio` decorators (auto handles it).
- Settings via `pydantic-settings`; default values are dev-only and the app must refuse to start in non-development environments with placeholder secrets (Wave 2 work — see ce:review residual).

## TypeScript (apps/web, apps/mobile, packages/shared)

- Strict TS. Web uses Next.js 15 App Router. Mobile uses Expo Router.
- Auth is Supabase magic-link in v1. Apple + Google sign-in providers configured in Supabase dashboard, not code.
- Never hand-write Zod schemas in `packages/shared/` — they're generated from Pydantic. Hand-edits will be overwritten and silently drift.

## Repo-relative paths

All paths in docs, plans, brainstorms, and code comments use **repo-relative** form (`apps/api/src/foo.py`), never absolute (`/Users/ryan/Documents/da2/...`). Absolute paths break portability across machines and contributors.

## Cross-platform

Every setup instruction in a README must include macOS, Linux, and Windows paths or use a portable installer (`curl|sh` script, `npm -g`, `pip install`). `brew install ...` alone is not acceptable; pair it with the Linux/Windows equivalent.

## Secrets

- Never inline a generated secret into a shell command in a doc. Generate to a 0600 file, set the secret from the file, then `shred` the file.
- Encryption keys live in Fly secrets / Vercel env / GitHub Actions — never in the repo, never in migrations, never in shell history.
- Strava token encryption uses Python-side Fernet AEAD (`apps/api/src/security/token_crypto.py`) — the symmetric key never traverses SQL. Multiple keys are supported via `STRAVA_TOKEN_KEYS=v:hex,v2:hex,...`; the highest version is used for new encryptions, all listed versions are tried for decryption. Each `strava_tokens` row stamps its `key_version` so rotation can be incremental.
- The startup config validator (`apps/api/src/config.py::Settings._validate_secrets_for_env`) refuses to boot with placeholder secrets in `app_env in {staging, production}`. Every new sensitive setting added here must extend that validator.

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
