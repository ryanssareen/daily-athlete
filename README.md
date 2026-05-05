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
  mobile/   Expo (React Native) — athlete app
  web/      Next.js 15 — coach + athlete app, also hosts the API (App Router route handlers)
packages/
  shared/   Cross-app TS types + Zod schemas
supabase/
  migrations/  Plain SQL migrations applied via Supabase CLI
docs/
  brainstorms/, plans/, solutions/
infra/      Deployment runbook (Vercel, Supabase, queue provider)
```

The backend lives inside `apps/web` as Next.js Route Handlers under `app/api/*` and runs as Vercel serverless functions. There is no separate Python service.

## Prerequisites

- Node 20.11+ and pnpm 9 (`npm i -g pnpm` or `corepack enable`)
- Docker (only needed if you want a local Postgres without the Supabase CLI stack)
- Supabase CLI — macOS: `brew install supabase/tap/supabase`; Linux: see [supabase/cli releases](https://github.com/supabase/cli/releases); Windows: `scoop install supabase`

## First-time setup

```bash
# Install workspace deps
pnpm install

# Copy env files
cp .env.example .env
cp apps/mobile/.env.example apps/mobile/.env
cp apps/web/.env.example apps/web/.env

# Generate a Strava token encryption key (32 bytes hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# paste into STRAVA_TOKEN_KEY in apps/web/.env

# Bring up local Postgres
docker compose up -d
# (or: `supabase start` for the full Supabase local stack)

# Apply migrations
supabase db reset --local --db-url "postgresql://da2:da2_dev@localhost:54322/da2"
```

## Running locally

```bash
# Terminal 1: services
docker compose up

# Terminal 2: web (also serves /api/*)
pnpm --filter @da2/web dev

# Terminal 3: mobile
pnpm --filter @da2/mobile start
```

## Deploying

See [infra/README.md](infra/README.md) for the third-party provisioning runbook (Supabase project, Vercel project, queue provider, Sentry, Langfuse).

## Conventions

See [docs/solutions/migration-conventions.md](docs/solutions/migration-conventions.md) for migration naming and ordering.
