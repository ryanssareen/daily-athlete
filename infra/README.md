# Infrastructure & Provisioning Runbook

This directory documents how to wire DA2 to its third-party services. The repo and CI
work locally without any of these provisioned — services are required only for staging
and production.

## Overview

| Service | Purpose | Wave 1 | Wave 2+ |
|---|---|---|---|
| Supabase | Postgres + Auth + Realtime + Storage | Required for staging | — |
| Vercel | Next.js app + API route handlers (serverless) | Required for staging | — |
| Queue (TBD per Unit 1.5; default: Inngest) | Background jobs for LLM, Strava backfill, scheduled work | Optional in Wave 1 | Required by Wave 3 |
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

Then copy these values into `apps/web/.env.local` and `apps/mobile/.env`:

- `NEXT_PUBLIC_SUPABASE_URL` (mobile: `EXPO_PUBLIC_SUPABASE_URL`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (mobile: `EXPO_PUBLIC_SUPABASE_ANON_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY` (web only — server-side, used by webhook handlers and admin paths)

Also: enable Apple + Google sign-in providers in the Supabase Auth dashboard.

## 2. Vercel (Next.js + API)

The Next.js app at `apps/web` hosts both the UI and the API. Route handlers under `app/api/*` deploy as serverless functions automatically.

```bash
# From apps/web
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add STRAVA_TOKEN_KEYS         # versioned hex keys, see Wave 2
vercel env add STRAVA_CLIENT_ID
vercel env add STRAVA_CLIENT_SECRET
vercel env add OPENAI_API_KEY            # or ANTHROPIC_API_KEY, set in Wave 3
vercel deploy --prod
```

Notes:
- Default function timeout on Pro is 60s; enable **Fluid Compute** to push to 300s for AI plan generation. Anything longer goes through the queue.
- Vercel Cron schedules live in `apps/web/vercel.json` once Wave 3 / Wave 5 introduce scheduled work.

## 3. Background-job queue (TBD — Unit 1.5)

The queue provider is decided in Unit 1.5. Default candidate: **Inngest**.

Inngest sketch (placeholder until 1.5 lands):

```bash
# In apps/web
pnpm add inngest
# A handler at apps/web/app/api/inngest/route.ts serves the Inngest webhook.
# Functions are defined in apps/web/src/jobs/*.ts and registered with the handler.
```

Alternatives:
- **Upstash QStash** — simplest, just delayed HTTP POSTs; no step orchestration.
- **Supabase Edge Functions + pg_cron** — keeps everything inside Supabase; awkward for long LLM calls and lacks retry/orchestration primitives.

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
`apps/web/src/config.ts` and `apps/mobile/src/config.ts`; missing keys disable the
feature gracefully (no boot failure).

## Local development without any of the above

```bash
# Postgres only
docker compose up -d
# Next.js talks to local Postgres via DATABASE_URL.
# JWT verification uses NEXT_PUBLIC_SUPABASE_URL pointed at `supabase start` for full auth,
# or a local-dev fallback secret if you only need DB.
# Strava + Sentry + Langfuse + RevenueCat all gracefully no-op.
```
