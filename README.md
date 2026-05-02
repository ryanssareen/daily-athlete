# DA2 — AI Endurance Training App

Greenfield monorepo. Athlete-first endurance training app with AI plan generation, Strava integration, and a coach-side editor.

See:
- Product brainstorm: [docs/brainstorms/2026-05-02-ai-endurance-training-app-requirements.md](docs/brainstorms/2026-05-02-ai-endurance-training-app-requirements.md)
- Schema brainstorm: [docs/brainstorms/2026-05-02-database-schema-requirements.md](docs/brainstorms/2026-05-02-database-schema-requirements.md)
- Product plan: [docs/plans/2026-05-02-001-feat-ai-endurance-training-app-plan.md](docs/plans/2026-05-02-001-feat-ai-endurance-training-app-plan.md)
- Schema plan: [docs/plans/2026-05-02-002-feat-database-schema-plan.md](docs/plans/2026-05-02-002-feat-database-schema-plan.md)

## Layout

```
apps/
  api/      FastAPI + SQLAlchemy 2.x + Pydantic v2 (Python 3.13)
  mobile/   Expo (React Native) — athlete app
  web/      Next.js 15 — coach app
packages/
  shared/   Cross-app TS types (Pydantic-generated Zod schemas land here)
supabase/
  migrations/  Plain SQL migrations applied via Supabase CLI
docs/
  brainstorms/, plans/, solutions/
infra/      Deployment runbook (Fly.io, Vercel, Supabase wiring)
```

## Prerequisites

- Node 20.11+ and pnpm 9 (`brew install pnpm` / `corepack enable`)
- Python 3.13 and [uv](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh` on macOS/Linux; `irm https://astral.sh/uv/install.ps1 | iex` on Windows)
- Docker (for local Postgres + Redis)
- Supabase CLI — macOS: `brew install supabase/tap/supabase`; Linux: see [supabase/cli releases](https://github.com/supabase/cli/releases); Windows: `scoop install supabase`

## First-time setup

```bash
# Install root + workspace deps
pnpm install

# Copy env files
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env
cp apps/web/.env.example apps/web/.env

# Generate a Strava token encryption key (32 bytes hex)
python -c "import secrets; print(secrets.token_hex(32))"
# paste into STRAVA_TOKEN_KEY in apps/api/.env

# Bring up local Postgres + Redis
docker compose up -d

# Apply migrations
supabase db reset --local --db-url "postgresql://da2:da2_dev@localhost:54322/da2"
# (or run psql against each migration file in order)

# Set up the API
cd apps/api
uv sync
uv run pytest
```

## Running locally

```bash
# Terminal 1: services
docker compose up

# Terminal 2: API
cd apps/api && uv run uvicorn src.main:app --reload --port 8000

# Terminal 3: web
pnpm --filter @da2/web dev

# Terminal 4: mobile
pnpm --filter @da2/mobile start
```

## Deploying

See [infra/README.md](infra/README.md) for the third-party provisioning runbook (Supabase project, Fly.io app, Vercel project, Sentry, Langfuse).

## Conventions

See [docs/solutions/migration-conventions.md](docs/solutions/migration-conventions.md) for migration naming and ordering.
