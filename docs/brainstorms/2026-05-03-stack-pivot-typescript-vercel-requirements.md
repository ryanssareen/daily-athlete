---
date: 2026-05-03
topic: stack-pivot-typescript-vercel
---

# Stack Pivot — Drop Python/Fly, Move to Next.js + Supabase + Vercel

## Problem Frame

The Wave-1 stack (Python 3.13 + FastAPI + Arq workers on Fly.io, Next.js on Vercel,
Expo for mobile, Supabase for Postgres + Auth + Realtime) cannot run completely free
in 2026:

- Fly.io removed its free tier.
- Render's free tier has 30-second cold starts, which is a product-killer for athlete
  app responsiveness and webhook ingest.
- Self-hosting on Oracle Cloud Always Free works but requires ops bandwidth a solo
  founder doesn't have.

We need a stack that runs free during 0–6 month validation, doesn't have cold-start
dealbreakers, and doesn't paint us into a corner when we hit free-tier walls.

The proposed pivot collapses the Python tier into TypeScript inside Next.js,
runs everything on Vercel + Supabase free tiers, and uses Vercel `waitUntil()` +
Vercel Cron + Supabase Edge Functions for the work that previously lived in
FastAPI + Arq. Mobile (Expo), Strava integration, RevenueCat, and LLM provider
choices are unchanged.

This document captures the decision after pressure-testing the pivot against
eight axes (feature fit, Python-ecosystem loss, Edge vs Vercel, free-tier
ceiling, migration cost, lock-in, alternatives, compounding).

## Requirements

**Stack pivot scope**

- R1. All backend logic moves from `apps/api/` (Python + FastAPI) to `apps/web/app/api/` (Next.js route handlers). The `apps/api/` directory is deleted in the pivot landing PR.
- R2. Supabase remains the source of truth for Postgres + Auth + Realtime + Storage. All migrations under `supabase/migrations/` continue unchanged.
- R3. Background work that previously ran on Arq workers is replaced by: (a) Vercel `waitUntil()` for fire-and-forget after-response work, (b) Vercel Cron for scheduled work, (c) Supabase Edge Functions only when database-trigger-driven invocation or latency-to-DB justifies the second runtime.
- R4. Mobile (Expo), the schema, RLS policies, eval-harness intent, monetization model, and product roadmap are unchanged by this pivot. The brainstorm artifacts and existing plans remain authoritative for product behavior.+

**AI plan generation architecture (forced by 300s timeout ceiling)**
- R5. AI plan generation is designed as a resumable, checkpointed pipeline persisted to Supabase between stages — never as a single function call that depends on staying alive for the full pipeline duration.
- R6. Each pipeline stage (periodization → week expansion → workout detail) is independently invokable from a Next.js route. Failure or timeout at any stage leaves the plan in a recoverable `partial` state with a `next_stage` pointer.
- R7. Plan generation kicks off via a foreground request that schedules the first stage and returns immediately; subsequent stages run on Vercel functions triggered by chained `waitUntil()` or by a polling cron, not by holding a single connection open.

**Eval and observability**
- R8. The Promptfoo eval harness may remain in Python (CI-only) talking to the TS API over HTTP. We do not abandon Python ecosystem benefits where they don't sit on the production hot path.
- R9. Langfuse JS SDK replaces Python tracing in production runtime. Anthropic + OpenAI TS SDKs replace their Python equivalents.

**Free-tier protection**

- R10. A Vercel Cron job pings the API every ≤6 hours to keep Supabase free-tier from auto-pausing (7-day idle threshold). This consumes 1 of 2 free Hobby cron slots; we accept this.
- R11. Cron schedule budget is explicitly tracked: weekly review (1 slot), Supabase keepalive (1 slot) consume the Hobby quota. Strava raw-payload retention sweep moves to `pg_cron` inside Supabase, not Vercel Cron.
- R12. The Strava 200-activity backfill is implemented as chunked recursion (25-activity pages, each its own function invocation) rather than a single 60-second function call, so the 300s ceiling never matters and retries are per-chunk.

**Migration discipline**
- R13. The pivot lands as a single PR (or short, sequenced PRs) — not a half-pivot with Python lingering. The Python toolchain (`uv`, `ruff`, `mypy`, `pyproject.toml`, `Dockerfile`, `Dockerfile.worker`, `fly.toml`, `pytest`) is fully removed in the same change.
- R14. CI is simplified to a single Node-based pipeline: typecheck, lint, unit tests, schema-migration apply, drift check.
- R15. `AGENTS.md` is rewritten in the pivot PR to reflect the new posture (TypeScript-only, Vercel runtime, the resumable-AI-pipeline rule, the cron-budget rule). The old "Python (apps/api/)" section is deleted, not annotated.

**Token encryption parity**
- R16. The Fernet-equivalent ciphertext format produced by `cryptography.Fernet` in the Python implementation is preserved bitwise so the encryption key in `STRAVA_TOKEN_KEYS` continues to decrypt any rows that exist in dev. Greenfield production has no rows yet, so any compatible AEAD (Fernet via `@noble/ciphers` or AES-GCM via `node:crypto`) is acceptable; pick one and document.

## Success Criteria

- All `/health`, `/me`, `/me` PATCH, and `/me/entitlements` endpoints behave identically to the Wave-1 Python implementation, verified by an integration test suite that exercises the same scenarios as the Python tests.
- CI on the pivot PR is fully green with no Python steps remaining.
- The Vercel preview deploy on the pivot PR boots and serves `/health` in <1s without cold-start anomalies measurable to the user.
- Supabase free-tier auto-pause does not fire during a 14-day inactive window (verified by the keepalive cron).
- AI plan generation (planned for Wave 3) is designed to never require a single function call exceeding 60 seconds, even when accounting for retries and validation failures.
- Total monthly hosting cost remains $0 for the first 100 active athletes.

## Scope Boundaries

- **No change to product behavior.** The pivot is a stack-only change. Wave 2+ feature scope, brainstorm decisions, and schema plan are all preserved.
- **No change to the mobile app's stack.** Expo + RN + supabase-js stays.
- **No move away from Supabase.** Convex, Neon-only, custom Postgres are explicitly rejected — Supabase Auth + Realtime + Storage are too valuable to lose.
- **No move to Cloudflare Workers in v1.** Workers is a credible alternative to Vercel functions for the API layer, but introducing it in the pivot adds a third runtime. Reconsider only if Vercel free-tier limits force the decision.
- **No half-measures.** We do not keep `apps/api/` "for the eval harness" or "for one heavy job." Eval harness can stay Python in CI; nothing else.
- **The decision applies to v1 only.** A Wave 3 reassessment can extract a Python sidecar (Cloudflare Workers via Pyodide, or a $4/mo Hetzner VM) if AI orchestration genuinely outgrows TypeScript ergonomics. Plan for that possibility in the AI pipeline interface design (R5–R7), but don't pre-build it.

## Key Decisions

- **Pivot now, not later.** The Wave-1 codebase is the smallest the Python footprint will ever be. Every Wave 2 unit shipped in Python adds ~0.5–1 day to the eventual migration; Wave 3 (AI orchestration) doubles that. The cheapest possible moment is before Wave 2 starts.
- **TypeScript everywhere on the production hot path.** Mobile (Expo TS) + Web (Next.js TS) + API (Next.js route handlers TS) + shared schemas (Zod). One language, one type system, no codegen between API and clients.
- **Vercel functions are the default runtime; Supabase Edge Functions are an exception.** Default to one runtime to avoid maintaining two SDK setups, two auth helpers, two encryption helpers. Add Edge Functions only when pg_net or DB-locality demands it.
- **Eval harness stays Python in CI.** Promptfoo + Inspect ecosystem advantages live in CI where TS parity doesn't matter. Production runtime is TS-only.
- **AI plan generation MUST be designed as resumable checkpoints.** The 300s Vercel Fluid Compute ceiling is a hard architectural constraint; designing for it now is good engineering regardless of stack.
- **Cron quota is a real budget.** Vercel Hobby = 2 schedules. Allocate explicitly: weekly review + Supabase keepalive. Anything else uses `pg_cron`.
- **Lock-in posture is acceptable.** Vercel + Supabase exit paths exist (Cloudflare Pages, self-hosted Postgres, Pusher/Ably for Realtime). The pivot does not worsen lock-in vs the current Fly + Supabase setup.

## Dependencies / Assumptions

- Supabase free tier remains: 500 MB DB, 2 GB egress/month, 7-day auto-pause, 500k Edge Function invocations.
- Vercel Hobby free tier remains: 100 GB bandwidth, ~100k function invocations on Fluid Compute, 2 cron schedules, 300s function timeout, free `waitUntil()`.
- LLM provider costs are independent of stack — Python or TS, ~$0.30 per generated plan and ~$0.005 per insight bills the same.
- A solo founder is doing the work; ops-burden alternatives (Oracle Cloud Always Free, Hetzner) are downgrades for this team shape.
- "Live on a free URL" is more important than "absolute best architecture" for the next 6 months. Pivot only matters if the project itself stays alive long enough to outgrow the free tier.

## Migration Effort (Estimate)

- Direct port of `apps/api/`: ~750 lines of Python source + ~400 lines of tests, roughly 1.5–3 working days for AI-assisted port to TypeScript.
- Cleanup (delete Python toolchain, simplify CI, update AGENTS.md, delete Dockerfiles + fly.toml): ~1 day.
- AI plan generation interface (R5–R7) — design only, implementation lands in Wave 3: ~half a day of interface decisions captured in the planning doc.
- **Total: 2–4 working days end-to-end.** Verifiable by a pivot-PR landing CI green with a working preview deploy.

## Outstanding Questions

### Resolve Before Planning

- *(none — the pivot decision itself is made; planning will sequence the migration units)*

### Deferred to Planning

- [Affects R5–R7][Technical] Concrete shape of the resumable-checkpoint AI pipeline: durable state shape in `plans` / `weekly_reviews`, retry semantics, observability into stage failures.
- [Affects R12][Technical] Strava backfill chunking strategy: page size, recursion via `waitUntil` vs cron-driven worker queue, max-attempt limits per chunk.
- [Affects R16][Needs research] Fernet ciphertext format compatibility — confirm `@noble/ciphers` or chosen library produces format-compatible output, or accept a one-time re-encryption (greenfield: zero existing rows in prod).
- [Affects R3][Technical] Whether to introduce a lightweight job-tracking table in Supabase (`background_jobs`) so `waitUntil` work has observability + retry semantics, or whether per-feature ad-hoc tracking is sufficient.
- [Affects R10–R11][Technical] Exact Vercel Cron schedules + Supabase keepalive endpoint shape; whether `pg_cron` covers the retention sweep at our free-tier Postgres limits.
- [Affects R14][Technical] Whether to use Drizzle ORM, Kysely, or raw `supabase-js` typed queries on the API side — affects the schema-drift-check approach.
- [Affects R8][Needs research] Eval harness sidecar: lightweight CI invocation pattern (Python script in `evals/` dir, separate uv-managed venv only inside CI, or a fully separate repo).

## Next Steps

→ `/ce:plan` for structured implementation planning.
