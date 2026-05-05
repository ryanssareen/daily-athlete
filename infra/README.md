# Infrastructure & Provisioning Runbook

This directory documents how to wire DA2 to its third-party services. The repo and CI
work locally without any of these provisioned — services are required only for staging
and production.

## Overview

| Service | Purpose | Wave 1 | Wave 2+ |
|---|---|---|---|
| Supabase | Postgres + Auth + Realtime + Storage | Required for staging | — |
| Container PaaS (Railway or Render — TBD, see Unit 1.5) | FastAPI + Arq workers | Required for staging | — |
| Upstash Redis | Arq job queue | Required for staging | — |
| Vercel | Next.js coach web | Required for staging | — |
| Expo EAS | iOS + Android builds | Optional in Wave 1 | Required by Wave 2 |
| Sentry | Error tracking | Optional | Recommended before public beta |
| Langfuse | LLM tracing | Optional in Wave 1 | Required by Wave 3 (AI plans) |
| RevenueCat | IAP unification | — | Required by Wave 5 |
| Strava API | OAuth + webhooks | — | Required by Wave 2 |
| Resend (or similar) | Coach invitation emails | — | Required by Wave 4 |

## 1. Supabase

```bash
# Create project at https://supabase.com (or via CLI)
supabase login
supabase projects create da2 --org-id <org> --db-password <password>

# Link this repo to the project
supabase link --project-ref <project-ref>

# Apply migrations
supabase db push
```

Then copy these values into `apps/api/.env`, `apps/web/.env.local`, and `apps/mobile/.env`:

- `SUPABASE_URL` (web/mobile: `NEXT_PUBLIC_SUPABASE_URL`)
- `SUPABASE_ANON_KEY` (web/mobile: `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY` (api only)
- `SUPABASE_JWT_SECRET` (api only — find via `supabase status` or dashboard)

Also: enable Apple + Google sign-in providers in the Supabase Auth dashboard.

## 2. Container PaaS (FastAPI + Arq) — TBD

The host for the FastAPI `web` process and the Arq `worker` process is not yet
chosen. Fly.io is **explicitly out**. The two candidates evaluated in Unit 1.5 are
**Railway** and **Render**; pick one before writing the Dockerfiles.

Whichever is picked, the shape is the same:

- Two services from this repo: `web` (uvicorn) and `worker` (Arq), each with its own
  Dockerfile (`apps/api/Dockerfile`, `apps/api/Dockerfile.worker`) or start command.
- Secrets set via the provider's secret store. Required at minimum:
  - `DATABASE_URL` — Supabase Postgres connection string
  - `SUPABASE_JWT_SECRET`
  - `STRAVA_TOKEN_KEY` — `python -c "import secrets; print(secrets.token_hex(32))"`
  - `REDIS_URL` — Upstash (see below)

Provider-specific config files land in Unit 1.5 (`railway.toml` *or* `render.yaml`).

The Strava token encryption key must be set before any user connects Strava —
without it, encrypt/decrypt fail at startup.

### Redis (Upstash)

Use Upstash Redis regardless of which PaaS is chosen — it's provider-agnostic and
keeps the queue layer portable. Create a database, copy the `REDIS_URL`, and set it
as a secret on both the `web` and `worker` services.

## 3. Vercel (Next.js)

```bash
# From apps/web
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add NEXT_PUBLIC_API_URL
vercel deploy --prod
```

## 4. Expo EAS (mobile builds)

```bash
# From apps/mobile
eas init
eas build --platform ios --profile development
eas build --platform android --profile development
```

EAS picks up env vars from `eas.json` profiles. Configure when Wave 1 mobile shells
are ready for device testing.

## 5. Sentry, Langfuse, RevenueCat

Set the corresponding env vars when the projects are ready. The app code reads them via
`apps/api/src/config.py` and the JS env-var conventions; missing keys disable the
feature gracefully (no boot failure).

## Local development without any of the above

```bash
# Postgres + Redis only
docker compose up -d
# FastAPI talks to local Postgres directly via DATABASE_URL.
# JWT verification uses SUPABASE_JWT_SECRET=local-jwt-secret-replace-me.
# Strava + Sentry + Langfuse + RevenueCat all gracefully no-op.
```
