---
title: "feat: AI Endurance Training App — v1 Implementation Plan"
type: feat
status: active
date: 2026-05-02
origin: docs/brainstorms/2026-05-02-ai-endurance-training-app-requirements.md
---

# AI Endurance Training App — v1 Implementation Plan

## Overview

Greenfield product. Athlete-first, dual-sided endurance training app:
- Athletes use a native iOS/Android app to plan, train, and complete workouts.
- Coaches use a web app to view, edit, and comment on connected athletes' plans.
- The wedge is **AI-generated triathlon periodization with weekly athlete-confirmed adaptation** plus **free per-workout AI insights** as the acquisition hook.
- Strava is the only completion-sync surface in v1.
- Monetization is athlete-paid freemium across App Store / Play Store / Stripe via a single account identity.

This plan turns the requirements doc (`docs/brainstorms/2026-05-02-ai-endurance-training-app-requirements.md`) into a 3–4 month MVP build, with research-grounded stack choices and a phased delivery sequence.

## Problem Frame

See origin: `docs/brainstorms/2026-05-02-ai-endurance-training-app-requirements.md`. The hybrid "AI does the volume, coach adds judgment" wedge is unoccupied: Runna/Humango are AI-only and run-heavy, TrainingPeaks/Final Surge are coach-only and AI-less. The product wins or loses on AI plan quality, so the eval harness is a Phase-1 deliverable, not a nice-to-have.

## Requirements Trace

This plan covers all R1–R31 from the origin document. Each implementation unit lists the requirements it advances. Verifying coverage:

- **Onboarding & profile (R1–R4):** Units 2.1–2.3
- **AI plan generation (R5–R8):** Units 3.1–3.3
- **Adaptivity (R9–R11):** Unit 3.4
- **Workout completion (R12–R15):** Unit 2.4
- **Calendar (R16–R17):** Unit 2.5
- **Coach in v1 (R18–R21):** Units 4.1–4.3
- **Daily insights (R22–R23):** Unit 5.1
- **Reports (R24–R25):** Unit 5.2
- **Monetization (R26–R28):** Units 5.3–5.4
- **Platforms (R29–R31):** Units 1.1–1.4

## Scope Boundaries

Carry forward from the origin doc — same v1 non-goals (no Garmin/HealthKit, no marketplace, no nutrition planner, no social, no fine-tuned model, no athlete web, no native coach app).

This plan additionally excludes:
- No internationalization in v1 (English only, US units + metric toggle).
- No team/club/family-sharing entitlements (single-athlete subscription only).
- No GDPR data-residency choices in v1 (single US region; EU users accept that posture).
- No coach payouts or invoicing flows.

## Stack Summary

| Concern | Choice | Why | Alternative considered |
|---|---|---|---|
| Athlete mobile | **React Native + Expo (EAS)** | TypeScript reuse with coach web; Expo Router + EAS for fast iteration; Strava OAuth via `expo-auth-session`; mature push, calendar, deep-linking. | Flutter (better custom canvas, weaker code sharing); two-native (wrong for small team + 3-4mo MVP). |
| Coach web | **Next.js 15 (App Router) + TypeScript** | Shares Zod schemas / API client with mobile; SSR for SEO on marketing surfaces; Vercel-ready. | Remix (smaller community), pure SPA (loses SEO). |
| Backend | **Python 3.13 + FastAPI** | AI tooling ecosystem (Pydantic v2, Instructor, eval libs) is Python-first in 2026; Strava webhooks + scheduled jobs fit cleanly. | Node/Hono (TS unification), but loses AI ergonomics. |
| Database (primary) | **Postgres 17** (managed via Supabase or Neon) | Handles all v1 entities at MVP scale with proper indexing. | TimescaleDB only when raw stream rows dominate (deferred). |
| Object storage | **Cloudflare R2** | Cheap, S3-compatible, no egress fees for stream summaries / report exports. | AWS S3. |
| Auth | **Supabase Auth** (if on Supabase) **/ Clerk** otherwise | Email + Apple + Google + magic link out of the box; Strava is a per-user resource grant handled separately. | better-auth (more control, more setup). |
| Real-time sync | **Supabase Realtime** (Postgres row broadcast over websockets) | Coach edits are last-write-wins on server-authoritative rows — no CRDT needed. | Ably if not on Supabase. |
| Background jobs | **Arq** (Python, Redis-backed) | Lightweight; integrates with FastAPI; weekly review + webhook hydration + insight generation. | Celery (heavier), Inngest (managed but pricey at insight-scale). |
| LLM (plans) | **Claude Opus 4.7** primary, **GPT-5** fallback | Strongest at structured rubric-following for periodization; prompt caching for athlete-profile context. | Single-shot prompting (drifts on long-horizon structure). |
| LLM (insights, free tier) | **Claude Haiku 4.5** or **GPT-5-mini** | Cheap, cached athlete-profile system prompt drops cost ~80%. | Mid-tier model (cost too high at free-tier scale). |
| Subscriptions | **RevenueCat** | Industry default for App Store + Play Store + Stripe entitlement unification. | Adapty (similar; pick if paywall A/B testing matters more). |
| Eval harness | **Promptfoo** (CI) + **Langfuse** (prod traces) | Lightest-weight scoring with deterministic + LLM-as-judge rubric; production tracing tied to evals. | Braintrust (heavier), Inspect (research-flavored). |
| Hosting | **Fly.io** (backend + Arq workers) + **Vercel** (Next.js) + **Supabase** (Postgres + Realtime + Auth) | Single-region MVP, cheap, websocket-friendly, fast deploys. | Render (similar), AWS (premature complexity). |
| Observability | **Sentry** (errors) + **Langfuse** (LLM) + Fly metrics | Cheap, covers what matters at MVP. | Datadog (overkill for MVP). |

The unifying choice is **Supabase as the platform layer** (Postgres + Auth + Realtime + Storage Edge) plus **Fly.io for the FastAPI app + Arq workers**. This minimizes the number of moving vendors while keeping the AI/job code in Python where the ecosystem is.

## Context & Research

### External References

- Expo Router + EAS: https://docs.expo.dev/router/introduction/
- Strava OAuth + webhooks + rate limits: https://developers.strava.com/docs/authentication/, https://developers.strava.com/docs/webhooks/, https://developers.strava.com/docs/rate-limits/
- Strava API agreement (storage limits): https://www.strava.com/legal/api
- FastAPI + Pydantic structured outputs: https://fastapi.tiangolo.com/
- Instructor (structured LLM outputs): https://python.useinstructor.com/
- Supabase Realtime: https://supabase.com/docs/guides/realtime
- RevenueCat docs + pricing: https://www.revenuecat.com/docs/, https://www.revenuecat.com/pricing/
- Promptfoo: https://www.promptfoo.dev
- Langfuse: https://langfuse.com
- Anthropic prompt caching: https://www.anthropic.com/news/prompt-caching
- OpenAI structured outputs: https://platform.openai.com/docs/guides/structured-outputs

### Institutional Learnings

None (greenfield repo). Build a `docs/solutions/` discipline starting with the eval harness and the Strava webhook dedup design.

## Key Technical Decisions

- **Monorepo with pnpm workspaces + Turborepo** for `apps/mobile`, `apps/web`, `apps/api`, `packages/shared` (Zod schemas + API client). Python `apps/api` lives in the same repo but is not part of the JS workspace; shared types are generated from Pydantic via `datamodel-code-generator` into `packages/shared`. Rationale: one source of truth for plan/workout schemas across athlete mobile, coach web, and backend.
- **Server-authoritative state model.** All plan and workout edits write to Postgres; clients subscribe. This keeps the coach-edit-to-mobile flow simple (no CRDT, no offline merge logic).
- **Strava is a per-user resource grant, not the auth provider.** Users sign up with email / Apple / Google via Supabase Auth, then connect Strava as a resource. This keeps the door open to additional sources (Garmin, HealthKit) without auth churn.
- **AI plan generation is a multi-step structured pipeline**, not a single prompt. Step 1 produces the periodization skeleton (blocks + weekly TSS targets); Step 2 expands each block into week shapes; Step 3 details each workout. Each step uses JSON-schema structured outputs and is independently evalable.
- **Adaptivity is weekly, athlete-confirmed.** A nightly Arq job per athlete builds a proposed adjustment for the next 1–3 weeks; the athlete sees it on Monday morning and accepts/edits/rejects. No silent replans.
- **Strava webhooks are "go fetch" signals, not the source of truth.** Hydrate via `GET /activities/{id}` on receipt, store the canonical record, then run a matcher to link the completed workout to a planned workout (same-day + sport + duration tolerance). Manual completion takes the same path with `source = manual`.
- **Subscription entitlements live in RevenueCat, mirrored to our DB on webhook.** Backend never trusts client claims; every paid feature checks an `entitlement` row updated by RevenueCat webhooks.
- **Free vs paid gating is a single decorator.** Backend endpoints declare `@requires_entitlement("ai_plans" | "trend_reports" | "coach_invite")`; mobile + web read entitlements from a single endpoint and gray-out paid surfaces for free users.
- **Eval harness ships before the AI feature.** No paid plan generation enters production without the harness scoring above an internal bar (≥80% of generated plans pass coach-graded review).

## Open Questions

### Resolved During Planning

- *Mobile stack*: Expo RN (see Stack Summary).
- *Backend language*: Python + FastAPI (AI ecosystem fit).
- *Database*: Postgres only at MVP; TimescaleDB deferred until raw stream rows dominate (>10M rows or >500ms weekly-report latency).
- *Real-time sync*: Supabase Realtime — coach edits are last-write-wins, no CRDT needed.
- *LLM provider*: Claude Opus 4.7 primary, GPT-5 fallback; Haiku/Mini for insights with prompt caching.
- *IAP unification*: RevenueCat.
- *Strava backfill scope*: Last 200 activities is within Strava's `GET /athlete/activities` rate budget; **store summary + reference URL only**, not raw streams indefinitely (Strava ToS).

### Deferred to Implementation

- *Exact JSON schemas* for plan / week / workout objects — define alongside Unit 3.1 once the prompt is being iterated.
- *Pace/HR-zone math constants* — derive from Joe Friel / Daniels conventions during Unit 2.3; expose as code constants, not user-facing config.
- *Push notification cadence* (insight delivery, weekly review reminder, missed-workout nudges) — A/B-able post-launch.
- *Pricing point* ($14.99 vs $19.99 vs $24.99/mo) — set during launch prep based on competitive scan + cost model from Unit 5.4.
- *Coach roster cap in v1* — likely no hard cap; revisit if a coach with 50+ athletes hits performance cliffs.
- *Apple/Google sign-in vs email-only* at v1 launch — both supported via Supabase Auth; Apple is required by App Store guidelines if any third-party social login is offered.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### System shape

```
 ┌──────────────────────┐                    ┌──────────────────────┐
 │  Athlete (Expo RN)   │                    │   Coach (Next.js)    │
 │  iOS + Android       │                    │   web                │
 └──────────┬───────────┘                    └──────────┬───────────┘
            │ REST + Supabase Realtime channel          │
            ▼                                            ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  FastAPI (Fly.io)                                                │
 │  - Auth proxy (Supabase JWT verify)                              │
 │  - REST: profiles, plans, workouts, comments, entitlements       │
 │  - Webhooks: Strava activity, RevenueCat                         │
 │  - Internal: triggers Arq jobs for AI work                       │
 └─────────┬───────────────────────────────────────┬────────────────┘
           │                                       │
           ▼                                       ▼
 ┌────────────────────┐                  ┌────────────────────┐
 │  Postgres (Supabase)│                 │  Arq workers       │
 │  + Realtime broker  │                 │  (Fly.io)          │
 │                     │                 │  - plan_generate   │
 │                     │                 │  - weekly_review   │
 │                     │                 │  - insight_for     │
 │                     │                 │  - strava_hydrate  │
 │                     │                 │  - profile_recompute│
 └────────────────────┘                  └─────────┬──────────┘
                                                   │
                                                   ▼
                                         ┌────────────────────┐
                                         │  LLM provider(s)    │
                                         │  Claude / OpenAI    │
                                         │  via Langfuse trace │
                                         └────────────────────┘

External:  Strava (OAuth + webhook)  ·  RevenueCat (subscription state)
Storage:   Cloudflare R2 (stream summaries, report exports)
```

### AI plan generation pipeline (Unit 3.1)

```
Inputs:
  athlete_profile  ← derived from Strava + ongoing workouts
  request          ← event_type, event_date, hours_avail, injuries

Step 1 (Periodization)
  → Claude Opus 4.7, schema = {blocks: [{kind, start, end, target_weekly_load}]}

Step 2 (Week expansion, fan-out per block in parallel)
  → Claude Opus 4.7, schema = {weeks: [{key_sessions: [...], rest_day, brick?}]}

Step 3 (Workout detailing, fan-out per workout in parallel)
  → Claude Haiku 4.5, schema = {structure: [...], rationale, target_pace_or_power}

Each step's output is validated against a Pydantic model.
On schema-validation failure: one retry with the validation error included
in the prompt. After two failures, surface a "couldn't generate plan;
please retry" error to the athlete and log to Langfuse for prompt review.
```

### Workout completion flow (Unit 2.4)

```
Strava activity created
   │
   ▼
Strava webhook  →  FastAPI /webhooks/strava
                       │ enqueue Arq: strava_hydrate(activity_id, athlete_id)
                       ▼
                   Arq worker
                       │ GET /activities/{id} from Strava
                       │ upsert completed_workouts (athlete_id, strava_activity_id) UNIQUE
                       │ run matcher: same-day + sport + duration tolerance
                       │ if matched, link to planned_workout; emit Realtime event
                       │ enqueue insight_for(completed_workout_id)
                       ▼
                   Mobile receives Realtime row update
                       → calendar shows green check + insight (when available)
```

## Implementation Units

Units are grouped into 5 phases. Phase boundaries are checkpoints; units within a phase have stated dependencies.

---

### Phase 1: Foundations (Weeks 1–3)

- [ ] **Unit 1.1: Monorepo + tooling skeleton**

**Goal:** Stand up the repo, package layout, type-share pipeline, CI, and dev environments so all later units have somewhere to land.

**Requirements:** R29, R30, R31

**Dependencies:** None.

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`
- Create: `apps/mobile/`, `apps/web/`, `apps/api/`, `packages/shared/`
- Create: `apps/api/pyproject.toml`, `apps/api/src/`, `apps/api/scripts/generate_shared_schemas.py`
- Create: `.github/workflows/ci.yml`
- Create: `README.md`, `AGENTS.md` (initial conventions)

**Approach:**
- pnpm workspaces + Turborepo for JS apps; `apps/api` is Python (uv or Poetry) outside the JS workspace.
- `packages/shared` exports Zod schemas generated from Pydantic models via `datamodel-code-generator`.
- CI runs: lint/typecheck/test for each app; `apps/api` runs ruff + mypy + pytest.

**Patterns to follow:** Standard 2026 Turborepo monorepo (one Python service alongside JS).

**Test scenarios:**
- Happy path: `pnpm turbo run build` builds web; `cd apps/api && uv run pytest` runs (empty) test suite.
- Integration: editing a Pydantic model and running `generate_shared_schemas.py` updates `packages/shared/types.ts` and is picked up by mobile + web typecheck.

**Verification:** All three apps boot locally with empty pages; CI runs green on the empty PR.

---

- [ ] **Unit 1.2: Supabase + auth + base data model**

**Goal:** Provision Supabase, configure email + Apple + Google sign-in, define core tables, and gate FastAPI on Supabase JWT.

**Requirements:** R1, R31

**Dependencies:** 1.1.

**Files:**
- Create: `apps/api/src/auth.py` (Supabase JWT verifier, FastAPI dependency)
- Create: `supabase/migrations/0001_init.sql`
- Create: `apps/api/src/models/user.py`, `models/athlete_profile.py`, `models/coach.py`
- Create: `apps/mobile/src/auth/`, `apps/web/src/auth/` (Supabase client wrappers)
- Modify: env files for `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

**Approach:**
- Tables (initial): `users` (mirrors Supabase auth.users), `athlete_profiles`, `coaches`, `entitlements`. Row-Level Security on all tables; service-role key used only server-side.
- FastAPI verifies the Supabase JWT on every request; `current_user` dependency.
- Apple sign-in is required by App Store guidelines whenever Google is offered.

**Patterns to follow:** Supabase Auth + JWT-verifying API gateway (standard pattern).

**Test scenarios:**
- Happy path: signup with email → user row exists in `users` and `auth.users`.
- Edge case: signup with Apple Hide-My-Email → email stored is the relay address.
- Error path: FastAPI request without bearer token returns 401.
- Integration: signing in on mobile produces a JWT that authenticates an `apps/api` request end-to-end.

**Verification:** A test user can sign up, get an `access_token`, and call `GET /me` successfully on FastAPI.

---

- [ ] **Unit 1.3: Mobile shell + navigation + design tokens**

**Goal:** Expo app boots on iOS + Android with auth, tab navigation (Today / Calendar / Insights / Profile), and a design system stub.

**Requirements:** R29

**Dependencies:** 1.1, 1.2.

**Files:**
- Create: `apps/mobile/app/_layout.tsx`, `apps/mobile/app/(tabs)/`, `apps/mobile/app/(auth)/`
- Create: `apps/mobile/src/design/` (tokens, typography, colors)
- Create: `apps/mobile/src/api/client.ts` (typed fetch wrapper sharing `packages/shared`)
- Create: `apps/mobile/src/realtime/supabase.ts` (Realtime client)

**Approach:**
- Expo Router file-based routing.
- Auth gate at root `_layout`; auth flows in `(auth)` group.
- API client uses Zod-validated responses from `packages/shared`.
- Sport color tokens defined now (used by calendar + reports later).

**Patterns to follow:** Expo Router auth-gate pattern (https://docs.expo.dev/router/reference/authentication/).

**Test scenarios:**
- Happy path: signed-out user lands on auth screen; signed-in user lands on Today tab.
- Edge case: token refresh on app foreground keeps user signed in.
- Integration: tab navigation persists across cold-start.

**Verification:** EAS build succeeds for iOS + Android; auth round-trip works on both simulators.

---

- [ ] **Unit 1.4: Coach web shell**

**Goal:** Next.js app with auth, athlete-roster page (empty state), and athlete-detail route ready for plan rendering later.

**Requirements:** R30, R21

**Dependencies:** 1.1, 1.2.

**Files:**
- Create: `apps/web/app/layout.tsx`, `apps/web/app/(coach)/roster/page.tsx`, `apps/web/app/(coach)/athletes/[id]/page.tsx`
- Create: `apps/web/src/api/client.ts`, `apps/web/src/auth/`

**Approach:**
- Same Supabase Auth setup as mobile.
- Roster page lists athletes connected to this coach (empty until Unit 4.1).
- Server components for SSR where it helps; client components for interactive editing.

**Test scenarios:**
- Happy path: coach signs in, sees empty roster + invite-CTA placeholder.
- Error path: athlete tries to access `/coach/*` and is redirected.

**Verification:** Coach can sign in on Vercel preview; roster route renders.

---

- [ ] **Unit 1.5: Hosting, observability, secrets**

**Goal:** Deploy infra so subsequent units have a target. Fly.io app for FastAPI + Arq workers, Vercel for Next.js, Supabase project, Sentry, Langfuse.

**Requirements:** R31

**Dependencies:** 1.1.

**Files:**
- Create: `apps/api/fly.toml`, `apps/api/Dockerfile`, `apps/api/Dockerfile.worker`
- Create: `apps/web/vercel.json` (if needed)
- Create: `infra/README.md` documenting environments (dev/staging/prod)
- Modify: `.github/workflows/deploy-api.yml`, `.github/workflows/deploy-web.yml`

**Approach:**
- Two Fly processes: `web` (FastAPI/uvicorn) and `worker` (Arq).
- Redis (Upstash or Fly Redis) for Arq queue.
- Sentry on both API and clients; Langfuse SDK initialized in `apps/api/src/llm/`.
- Secrets via Fly secrets / Vercel env / GitHub Actions.

**Test scenarios:** none — pure config/scaffolding.
- Test expectation: none — infrastructure scaffolding; verified by deployment success.

**Verification:** A no-op `/health` endpoint returns 200 from prod URL; Sentry captures a synthetic error.

---

### Phase 2: Athlete + Strava Core (Weeks 3–6)

- [ ] **Unit 2.1: Strava OAuth + token storage**

**Goal:** Athlete can connect Strava from the mobile app; refresh tokens are stored server-side; access token is refreshed transparently.

**Requirements:** R1

**Dependencies:** 1.2, 1.3, 1.5.

**Files:**
- Create: `apps/api/src/strava/oauth.py`, `apps/api/src/strava/client.py`
- Create: `supabase/migrations/0002_strava_tokens.sql`
- Create: `apps/api/src/models/strava_token.py`
- Create: `apps/mobile/src/integrations/strava.tsx`
- Create: `apps/api/tests/test_strava_oauth.py`

**Approach:**
- OAuth on mobile via `expo-auth-session` with PKCE; deep-link to Strava app when installed (`strava://oauth/...`), else in-app browser.
- Code-for-token exchange happens on FastAPI (`POST /integrations/strava/connect`); refresh token stored in `strava_tokens` row encrypted at rest.
- `StravaClient` wraps refresh-on-401 transparently and respects rate-limit headers (15-min + daily, read + overall).

**Patterns to follow:** Standard PKCE OAuth-on-mobile pattern.

**Test scenarios:**
- Happy path: athlete completes Strava OAuth and sees "Connected" in Profile.
- Edge case: Strava app installed → deep-link path; not installed → web fallback.
- Error path: athlete denies on Strava → graceful return + retryable state.
- Edge case: refresh token expired → re-auth prompt (no silent failure).
- Integration: token persists across app cold-start; `StravaClient` calls succeed with stored token.

**Verification:** From a clean install, athlete connects Strava and the backend successfully calls `GET /athlete` for that user.

---

- [ ] **Unit 2.2: Strava activity backfill + workout ingest**

**Goal:** On first Strava connection, fetch the last 200 activities, normalize, and persist as `completed_workouts` (source = strava). Subsequent activities arrive via webhook (Unit 2.4).

**Requirements:** R2

**Dependencies:** 2.1.

**Files:**
- Create: `apps/api/src/strava/backfill.py`
- Create: `apps/api/src/jobs/backfill_strava.py` (Arq task)
- Create: `supabase/migrations/0003_completed_workouts.sql`
- Create: `apps/api/src/models/completed_workout.py`
- Create: `apps/api/tests/test_strava_backfill.py`

**Approach:**
- Backfill runs as an Arq job triggered by Unit 2.1.
- Paginate `GET /athlete/activities` (200/page), respecting rate limits — chunk and back off when a 429 is returned.
- Normalize sport codes into our taxonomy (swim / bike / run / strength / mobility / other).
- Store summary fields only; do NOT persist raw streams (Strava ToS). For HR/power, store summary stats (avg/max/zones) returned by `/activities/{id}/zones` if present.
- Mark backfill status on `athlete_profiles` so the UI can show a progress state.

**Test scenarios:**
- Happy path: 200 activities fetched, normalized, persisted; status = `complete`.
- Edge case: athlete has fewer than 200 lifetime activities — finishes cleanly.
- Edge case: Strava returns activity with sport we don't recognize — stored as `other`.
- Error path: 429 from Strava → job re-enqueues with delay; no partial data corruption.
- Error path: refresh-token expired mid-backfill → status = `needs_reauth`, athlete sees prompt.

**Verification:** A test athlete with seeded Strava activity gets a populated `completed_workouts` set after backfill.

---

- [ ] **Unit 2.3: Athlete profile derivation + ongoing recompute**

**Goal:** Derive an initial athlete profile from backfilled activities; recompute as new completed workouts arrive.

**Requirements:** R2, R3, R4

**Dependencies:** 2.2.

**Files:**
- Create: `apps/api/src/profile/derive.py`
- Create: `apps/api/src/jobs/profile_recompute.py`
- Create: `apps/mobile/app/(tabs)/profile.tsx`
- Create: `apps/api/tests/test_profile_derive.py`

**Approach:**
- Derive: weekly volume (per sport) over trailing 12 weeks, dominant sport, pace baselines (Z2 pace per sport from EWMA of easy efforts), HR threshold estimate (Friel-style), power baseline if cycling power present (eFTP from best 20-min normalized power).
- Recompute on each completed-workout insert via a debounced Arq job per athlete (max once per 10 minutes).
- Manual profile edits (R4): age, weight, target event, weekly hours — stored on `athlete_profiles`, shown in profile tab. Backfilled fields do not overwrite manual edits.

**Patterns to follow:** Pydantic v2 models for profile shape; pure-Python derivation functions are unit-testable.

**Test scenarios:**
- Happy path: with 12 weeks of backfilled run activity, profile shows correct dominant sport + Z2 pace.
- Edge case: sparse data (< 4 weeks) → confidence flag set; AI later treats baselines cautiously.
- Edge case: outlier activity (race effort) does not skew Z2 pace.
- Integration: completing a new workout triggers profile recompute within the debounce window.
- Edge case: athlete edits weight manually; recompute does not overwrite it.

**Verification:** Profile screen shows non-empty fields after backfill completes for a seeded athlete.

---

- [ ] **Unit 2.4: Strava webhook + workout completion + dedup**

**Goal:** Strava webhook receives `create | update | delete` events; backend hydrates the activity, links it to a planned workout if one matches, and emits a Realtime event. Manual completion goes through the same path.

**Requirements:** R12, R13, R14, R15

**Dependencies:** 2.2.

**Files:**
- Create: `apps/api/src/webhooks/strava.py` (verification + ingest)
- Create: `apps/api/src/jobs/strava_hydrate.py`
- Create: `apps/api/src/services/match_workout.py`
- Create: `supabase/migrations/0004_planned_workouts.sql` (planned_workouts + workout_matches tables)
- Create: `apps/mobile/app/(modals)/log-workout.tsx` (manual completion)
- Create: `apps/api/tests/test_strava_webhook.py`, `tests/test_match_workout.py`

**Approach:**
- Webhook endpoint: GET (verification) + POST (event). Respond `<2s` with 200; enqueue hydration to Arq.
- Hydration: GET `/activities/{id}`, upsert `completed_workouts` with UNIQUE `(athlete_id, strava_activity_id)`. Idempotent.
- Matcher: candidate planned workouts = same athlete + scheduled_date within ±1 day + same sport + duration within ±50%; rank by closeness; record in `workout_matches` with `match_method = auto`. Store match confidence.
- Manual completion (R13) writes `completed_workouts` with `source = manual, strava_activity_id = NULL`. If a Strava event later arrives for the same effort (matcher detects ≤30-min start-time window), prefer Strava and merge actuals; mark manual record as superseded.
- Skip / reschedule (R14) updates `planned_workouts.status` directly; surfaced to the next weekly review.
- Soft-delete on Strava `delete` events (`completed_workouts.deleted_at`).

**Test scenarios:**
- Happy path: planned run on Saturday at 6 AM; Strava activity arrives Saturday 6:15 AM; matcher links them.
- Edge case: athlete completes the workout manually before Strava webhook arrives; Strava event arrives later → merged, manual marked superseded.
- Edge case: webhook delivered twice (Strava at-least-once) → idempotent upsert, no duplicate row.
- Edge case: athlete moves a planned workout (R17) while a Strava activity arrives — matcher uses the new scheduled_date.
- Error path: webhook arrives but Strava token revoked → store raw payload, mark for reauth.
- Error path: hydration GET 5xx → Arq retries with exponential backoff up to 6 attempts.
- Integration: Realtime event fires; mobile calendar updates the workout cell within 2 seconds.

**Verification:** From a planted Strava activity in a sandbox account, the planned workout transitions to "completed" on the athlete's calendar in under 5 seconds end-to-end.

---

- [ ] **Unit 2.5: Athlete calendar (read + drag-to-move)**

**Goal:** Athlete sees a multi-week calendar of planned + completed workouts; can drag-move a planned workout (within reason).

**Requirements:** R16, R17

**Dependencies:** 2.3, 2.4.

**Files:**
- Create: `apps/mobile/src/calendar/` (week view, day cell, drag handler)
- Create: `apps/mobile/app/(tabs)/calendar.tsx`
- Create: `apps/api/src/api/workouts.py` (GET range + PATCH planned workout date)
- Create: `apps/api/tests/test_workouts_api.py`

**Approach:**
- Week-based grid (7 cells per row). Sport color from design tokens (Unit 1.3). Completed = filled cell + check; planned = outline cell.
- Drag-move: PATCH `planned_workout.scheduled_date`; flag `moved_at` so the next weekly review (Unit 3.4) sees it.
- Move guardrail: cannot move into a finished week or past the event date; client-side hint + server-side validation.
- Subscribe via Supabase Realtime to `(plan_id, scheduled_date)` row changes for live updates from coach edits.

**Test scenarios:**
- Happy path: drag Tuesday's run to Wednesday → persists, calendar updates.
- Edge case: drag past event date → blocked with toast.
- Edge case: drag into a day with an existing workout → both kept (no merge); athlete can resolve later.
- Integration: coach edits date on web → mobile calendar reflects the change in <2s.

**Verification:** Athlete moves a workout, kills the app, reopens — workout is on the new day.

---

### Phase 3: AI Plan Core (Weeks 5–9, partly parallel with Phase 2)

- [ ] **Unit 3.1: Eval harness + reference plans**

**Goal:** Promptfoo-based eval harness with 30–50 coach-graded reference plans (built with alpha coaches) running in CI. **Ship this before Unit 3.2 generates production plans.**

**Requirements:** R8

**Dependencies:** 1.5 (Langfuse).

**Execution note:** Test-first — the harness IS the test surface for plan generation.

**Files:**
- Create: `apps/api/evals/promptfooconfig.yaml`
- Create: `apps/api/evals/fixtures/athletes/` (athlete profile JSONs)
- Create: `apps/api/evals/fixtures/reference_plans/` (coach-approved plan JSONs)
- Create: `apps/api/evals/assertions/deterministic.py` (volume ramp, taper presence, brick placement, recovery spacing, zone math)
- Create: `apps/api/evals/assertions/judge.py` (LLM-as-judge prompt)
- Create: `.github/workflows/evals.yml`

**Approach:**
- Half the rubric is deterministic Python checks: weekly volume ramp <10%, long run <30% of weekly volume, taper present in last 2 weeks, brick spacing within tri block, recovery week every 4th week.
- Half is LLM-as-judge against the reference plan: structural alignment, athlete-appropriateness, narrative coherence.
- Pass bar: ≥80% of generated plans pass on every commit; failures block deploy.
- Reference plans built with 3–5 alpha coaches over weeks 1–4 (parallel with Phase 1–2).

**Patterns to follow:** Promptfoo config + Python assertion plugins.

**Test scenarios:**
- Happy path: a hand-crafted "good" plan scores ≥0.9; a hand-crafted "bad" plan scores ≤0.4.
- Edge case: plan with missing taper fails the `taper_present` assertion specifically.
- Integration: CI run blocks merge when score regresses below threshold.

**Verification:** `promptfoo eval` runs end-to-end on a candidate plan and produces a deterministic score breakdown.

---

- [ ] **Unit 3.2: AI plan generation pipeline**

**Goal:** Multi-step structured generation (block → week → workout) producing a calendar-ready plan from athlete profile + event inputs.

**Requirements:** R5, R6, R7, R8

**Dependencies:** 2.3, 3.1.

**Execution note:** Iterate against the eval harness; do not promote a prompt change to prod without the harness passing.

**Files:**
- Create: `apps/api/src/ai/plan_pipeline.py`
- Create: `apps/api/src/ai/prompts/periodization.py`, `prompts/week_expansion.py`, `prompts/workout_detail.py`
- Create: `apps/api/src/ai/schemas/plan.py` (Pydantic models)
- Create: `apps/api/src/jobs/generate_plan.py` (Arq task)
- Create: `apps/api/src/api/plans.py` (POST /plans, GET /plans/{id})
- Create: `supabase/migrations/0005_plans.sql`
- Create: `apps/mobile/app/(modals)/new-plan.tsx`
- Create: `apps/api/tests/test_plan_pipeline.py`

**Approach:**
- Three steps as in High-Level Technical Design.
- Anthropic prompt caching on athlete-profile + coaching-knowledge system prompt (cached across all three steps for one athlete).
- Step 2 fans out per block, Step 3 fans out per workout — parallelized via `asyncio.gather`.
- Schema validation failure → one retry with the validation error appended; second failure → graceful error to user + Langfuse trace flagged.
- Plan generation gated on `requires_entitlement("ai_plans")`.
- Langfuse traces every step with token counts + latency.

**Technical design:** *(see High-Level Technical Design — pipeline diagram is directional; exact prompt content evolves with eval harness.)*

**Test scenarios:**
- Happy path: profile + Olympic-tri-in-16-weeks input → valid 16-week plan that passes eval rubric.
- Edge case: extreme inputs (Ironman in 6 weeks for a beginner) → AI is instructed to refuse and suggest realistic alternative; tested with assertion.
- Edge case: athlete with sparse profile data — pipeline lowers volume confidence.
- Error path: LLM returns invalid JSON twice → user-facing error, no half-written plan in DB.
- Error path: LLM provider 5xx mid-pipeline → falls over to fallback model (GPT-5).
- Integration: generated plan renders correctly on the mobile calendar.

**Verification:** End-to-end: athlete requests plan, sees it on calendar within 90 seconds; eval harness scores it ≥0.8 on the rubric.

---

- [ ] **Unit 3.3: Plan rendering on athlete calendar + workout detail**

**Goal:** Plan is visible on the calendar; tapping a workout shows structure, target intensity, rationale.

**Requirements:** R7, R16

**Dependencies:** 2.5, 3.2.

**Files:**
- Create: `apps/mobile/app/workout/[id].tsx`
- Modify: `apps/mobile/src/calendar/`
- Create: `apps/api/src/api/workouts.py` (GET workout detail with rationale)

**Approach:**
- Workout detail screen renders structure (warm-up / main set / cool-down with intervals + targets).
- "Why this workout?" section shows the AI rationale captured at generation time.
- Sport-specific rendering: swim shows distance + interval pace, bike shows power/HR targets, run shows pace, brick shows both legs.

**Test scenarios:**
- Happy path: tap a planned run → structure + rationale render.
- Edge case: missing rationale (older workout) → section hidden gracefully.
- Integration: completed workouts show actuals alongside targets.

**Verification:** All sport types render correctly on iOS + Android; coach-edited workouts show edits.

---

- [ ] **Unit 3.4: Weekly adaptive review**

**Goal:** Once per training week, generate proposed adjustments based on completed/missed/over-performed workouts; athlete accepts/edits/rejects.

**Requirements:** R9, R10, R11

**Dependencies:** 3.2, 2.4.

**Files:**
- Create: `apps/api/src/ai/weekly_review.py`
- Create: `apps/api/src/jobs/weekly_review.py` (Arq scheduled job)
- Create: `supabase/migrations/0006_weekly_reviews.sql`
- Create: `apps/mobile/app/(modals)/weekly-review.tsx`
- Create: `apps/api/src/api/weekly_review.py` (POST accept / reject / modify)
- Create: `apps/api/tests/test_weekly_review.py`

**Approach:**
- Scheduled Arq job runs Sundays 6 PM athlete-local; computes "actual vs planned" for the prior week + load trend; calls LLM with the next 1–3 weeks of plan + diff.
- Output is a `WeeklyReviewProposal` with concrete edits (`{workout_id, change}`) plus a narrative rationale.
- Athlete sees a banner Monday morning; modal shows proposed edits diff-style.
- Accept = apply edits to `planned_workouts`; reject = no-op; modify = athlete cherry-picks edits.
- Off-cycle replan (R11): same pipeline triggered on demand.

**Test scenarios:**
- Happy path: athlete missed Tuesday's run → proposal shifts volume to Thursday.
- Happy path: athlete crushed long ride → proposal nudges next week's bike volume up modestly.
- Edge case: athlete missed all workouts → proposal is conservative restart, not "make it up."
- Edge case: proposal would push a workout past event date → blocked at validation.
- Integration: accepting changes persists and updates calendar via Realtime.
- Integration: weekly review proposals are eval-harness-graded for sanity (Unit 3.1 covers this).

**Verification:** A 4-week dry run with seeded "athlete misses Tuesday" pattern produces sensible proposals every week.

---

### Phase 4: Coach + Real-Time (Weeks 8–11)

- [ ] **Unit 4.1: Coach invitation + connection**

**Goal:** Athlete invites a coach by email; coach signs up (if new) and sees the athlete in their roster.

**Requirements:** R18, R21

**Dependencies:** 1.4, 2.5.

**Files:**
- Create: `apps/api/src/api/coach_invites.py`
- Create: `supabase/migrations/0007_coach_athlete.sql` (coach_athlete_links + coach_invites)
- Create: `apps/web/app/(coach)/roster/page.tsx` (real version)
- Create: `apps/mobile/app/(modals)/invite-coach.tsx`
- Create: `apps/api/tests/test_coach_invite.py`

**Approach:**
- Athlete-side: invite by email → tokenized invite link sent via Resend (or Supabase Auth email).
- Invite link signs up coach (if new) and creates `coach_athlete_link` row.
- Coach roster query: all athletes linked to this coach.
- Athlete can revoke at any time (RLS enforces server-side cut-off).
- Inviting coach is gated on `requires_entitlement("coach_invite")`.

**Test scenarios:**
- Happy path: invite → email → coach signs up → roster shows athlete.
- Edge case: coach already on platform → link added without re-signup.
- Edge case: invite link expired (>7 days) → user-facing error + re-invite path.
- Error path: athlete on free tier tries to invite → entitlement error surfaced cleanly.
- Integration: revoking access immediately blocks coach API calls (RLS).

**Verification:** End-to-end flow on staging works; revocation cuts off access within seconds.

---

- [ ] **Unit 4.2: Coach plan editor + comments**

**Goal:** Coach can edit individual planned workouts (structure, date, notes) and leave comments on workouts and weeks.

**Requirements:** R19, R20

**Dependencies:** 4.1, 3.3.

**Files:**
- Create: `apps/web/app/(coach)/athletes/[id]/calendar/page.tsx`
- Create: `apps/web/app/(coach)/athletes/[id]/workouts/[wid]/page.tsx` (editor)
- Create: `apps/api/src/api/coach_edits.py`
- Create: `supabase/migrations/0008_workout_comments.sql`
- Create: `apps/api/src/models/workout_comment.py`

**Approach:**
- Coach calendar mirrors athlete calendar (same component, server-RLS limits to linked athletes).
- Workout edit form: structure (intervals), target intensity, scheduled_date, coach note.
- Edits persist with `edited_by_coach_id` + `edited_at` for attribution (R20).
- Comments are threaded on workouts and weeks; both athlete and coach can post.
- Athlete is notified (push) when a coach edits or comments.

**Test scenarios:**
- Happy path: coach edits Saturday's long run → athlete sees update + push notification.
- Happy path: coach posts a comment → athlete sees badge.
- Edge case: athlete edited the same workout offline; coach edit lands later → last-write-wins server-side, athlete's pending edit shows conflict toast on sync.
- Error path: coach tries to edit a workout for a non-linked athlete → 403 (RLS).

**Verification:** Coach edits propagate to mobile calendar in <2s and show "Edited by Coach Y" attribution.

---

- [ ] **Unit 4.3: Real-time sync wiring**

**Goal:** Mobile + web subscribe to Supabase Realtime channels for plans, workouts, and comments so all parties see edits live.

**Requirements:** R20

**Dependencies:** 4.2, 2.5.

**Files:**
- Modify: `apps/mobile/src/realtime/supabase.ts`
- Create: `apps/web/src/realtime/supabase.ts`
- Modify: calendar components on both clients to consume Realtime updates

**Approach:**
- One channel per `plan_id`; clients subscribe on mount of any plan-aware screen.
- Backend publishes via Postgres triggers configured in Supabase Realtime (no app-side broadcast needed).
- Local optimistic updates: client applies its own edit immediately, then reconciles with server echo.
- Disconnect handling: subscribe on app foreground; refetch on reconnect to recover dropped events.

**Test scenarios:**
- Happy path: coach edits on web → mobile updates within 2s.
- Happy path: athlete completes a manual workout → coach web reflects within 2s.
- Edge case: phone offline, coach edits, phone returns online → mobile reconciles via refetch.
- Edge case: network blip during subscribe → auto-reconnect, no missed events on reconnect.

**Verification:** Two-device test (athlete phone + coach laptop) shows edits propagating in <2s consistently.

---

### Phase 5: Insights, Reports, Monetization, Launch (Weeks 10–14)

- [ ] **Unit 5.1: Per-workout AI insights (free tier)**

**Goal:** After each completed workout, generate a short AI insight using a small model with cached athlete context.

**Requirements:** R22, R23

**Dependencies:** 2.4, 2.3.

**Files:**
- Create: `apps/api/src/ai/insights.py`
- Create: `apps/api/src/jobs/insight_for.py` (Arq task)
- Create: `supabase/migrations/0009_insights.sql`
- Modify: `apps/mobile/app/workout/[id].tsx`, `apps/mobile/app/(tabs)/index.tsx` (Today)

**Approach:**
- Triggered by completion event from Unit 2.4.
- Small model (Haiku 4.5 / GPT-5-mini) with cached system prompt = athlete profile + recent trend summary; user prompt = the new workout.
- Output: ≤2 sentences, optional metric callout. Stored on `insights` table linked to `completed_workout_id`.
- Per-athlete daily cap (e.g., 5/day) to prevent runaway cost on free tier from manual workout spam.

**Test scenarios:**
- Happy path: completed run → insight appears within 30s on Today + workout detail.
- Edge case: athlete completes 6 manual workouts in a day → 6th gets a generic recap, not a fresh LLM call.
- Edge case: athlete profile is too sparse → insight falls back to a templated "first workout logged" message.
- Error path: LLM fails → insight slot is skipped silently; no stuck loading state.
- Integration: insight pulls trend data correctly from profile recompute (Unit 2.3).

**Verification:** Cost per 100 insights stays within budget; latency P50 < 30s.

---

- [ ] **Unit 5.2: Reports (free + paid)**

**Goal:** Weekly/monthly/annual reports, free at the rollup level, paid unlocks trend analysis + AI narrative + race readiness score.

**Requirements:** R24, R25

**Dependencies:** 2.3, 5.1.

**Files:**
- Create: `apps/api/src/reports/rollup.py` (free)
- Create: `apps/api/src/reports/trends.py` (paid)
- Create: `apps/api/src/ai/report_narrative.py`
- Create: `apps/mobile/app/(tabs)/reports.tsx`
- Create: `apps/api/src/api/reports.py`

**Approach:**
- Free rollups computed on demand (or cached daily): time, distance, volume per sport; PRs detected from completed workouts.
- Paid trends: fitness/fatigue/form (CTL/ATL/TSB-style proxy from training load), pace/power EWMA, cross-sport balance, race-readiness as event approaches.
- AI narrative summary uses the same small-model + cached-context pattern as insights.

**Test scenarios:**
- Happy path: weekly report renders for an athlete with 4 weeks of data.
- Edge case: athlete with <2 weeks of data → trend section shows "not enough data yet."
- Error path: free user hits paid section → paywall (Unit 5.4).
- Integration: PR detection correctly flags a new fastest 5K within a longer run.

**Verification:** Reports render on mobile and show non-trivial trends after Phase 2 backfill.

---

- [ ] **Unit 5.3: Subscription entitlements + RevenueCat integration**

**Goal:** Single source of truth for entitlements (`ai_plans`, `trend_reports`, `coach_invite`) sourced from RevenueCat webhooks.

**Requirements:** R27, R28

**Dependencies:** 1.2.

**Files:**
- Create: `apps/api/src/webhooks/revenuecat.py`
- Create: `supabase/migrations/0010_entitlements.sql`
- Create: `apps/api/src/auth/entitlements.py` (decorator)
- Create: `apps/mobile/src/billing/revenuecat.tsx`
- Create: `apps/web/src/billing/stripe-redirect.ts` (RevenueCat-managed Stripe)

**Approach:**
- RevenueCat configured with three product offerings on App Store / Play Store / Stripe.
- App-user-id = our stable user UUID (set before any purchase).
- RevenueCat webhook updates `entitlements` table; backend `@requires_entitlement(...)` decorator gates endpoints.
- Mobile + web fetch entitlements via `GET /me/entitlements` and gray-out paid surfaces accordingly.

**Test scenarios:**
- Happy path: purchase on iOS sandbox → RC webhook → entitlement appears in DB → AI plan unlocks.
- Edge case: subscription lapses → entitlement removed within minutes of RC webhook.
- Edge case: family sharing on iOS → entitlement attributed to the correct app-user-id.
- Edge case: refund → entitlement revoked, gracefully revoked features.
- Error path: RC webhook lost → daily reconciliation job pulls subscriber state from RC API.

**Verification:** End-to-end purchase on iOS sandbox + Android testing track + Stripe test card all unlock plan generation.

---

- [ ] **Unit 5.4: Paywall flows + free-to-paid conversion surfaces**

**Goal:** Paywall modal on mobile + web at the right moments (try to generate plan, view trend section, invite coach).

**Requirements:** R26, R27

**Dependencies:** 5.3.

**Files:**
- Create: `apps/mobile/src/billing/paywall.tsx`
- Create: `apps/web/src/billing/paywall.tsx`
- Modify: relevant gated surfaces to render the paywall on entitlement miss

**Approach:**
- Single paywall component on each platform, configurable copy per trigger source.
- Use RevenueCat's hosted paywall on mobile for fastest ship; native overlay only if hosted UI doesn't fit.
- Free-tier nudges: insight at the bottom of every report ("unlock trend analysis…"), trial copy on coach-invite CTA.

**Test scenarios:**
- Happy path: free user taps "Generate plan" → paywall → purchase → returns to plan request flow seamlessly.
- Edge case: paywall canceled → user lands back on Today with no broken state.
- Edge case: existing paid user accidentally sees paywall (entitlement cache stale) → "Restore purchases" path works.

**Verification:** Conversion event tracked in analytics for each paywall surface.

---

- [ ] **Unit 5.5: Beta launch prep**

**Goal:** App Store + Play Store submission, Strava ToS compliance review, privacy policy, terms, support surface.

**Requirements:** Cross-cutting (R26, R27, R28; Strava ToS).

**Dependencies:** All prior units.

**Files:**
- Create: `apps/web/app/(marketing)/privacy/page.tsx`, `terms/page.tsx`
- Create: `docs/launch/app-store-checklist.md`, `play-store-checklist.md`, `strava-compliance.md`
- Create: `docs/launch/runbook.md` (incident, billing, Strava-API-down playbooks)

**Approach:**
- Privacy policy explicitly covers: Strava data scope, AI processing of training data, US-only data residency, retention, deletion (DELETE `/me` flow).
- App Store: AI training disclosure (no medical claims), subscription terms, restore purchases, account deletion in-app (required).
- Play Store: data safety form aligned with privacy policy.
- Strava brand-and-API agreement compliance: "Powered by Strava" badge, no raw stream re-distribution.
- Closed beta first via TestFlight + Play internal track; coach alpha cohort onboarded directly.

**Test scenarios:**
- Happy path: account deletion request fully removes user data within 30 days; Strava disconnect happens immediately.
- Edge case: Strava API downtime → app surfaces a banner; manual completion still works.

**Verification:** App Store + Play Store reviews pass on first or second submission.

---

## System-Wide Impact

- **Interaction graph:** Mobile ↔ FastAPI ↔ Postgres; mobile ⇄ Supabase Realtime; web ↔ FastAPI ↔ Postgres; web ⇄ Realtime; FastAPI → Arq workers → LLM providers; FastAPI ↔ Strava API; FastAPI ← Strava webhook; FastAPI ← RevenueCat webhook. Plan + workout edit paths must consistently emit Realtime events for all subscribers.
- **Error propagation:** LLM/Strava/RevenueCat failures surface as user-facing soft errors with retry; never crash the app. Backend errors logged to Sentry; LLM errors additionally traced in Langfuse.
- **State lifecycle risks:** Strava webhook arriving for an athlete who later disconnected; refund-after-feature-use; coach revocation while a coach edit is in flight; concurrent coach + athlete edit on the same workout.
- **API surface parity:** Every gated feature on web has a parallel paywall + entitlement check on mobile.
- **Integration coverage:** Realtime propagation, Strava-to-planned matcher, manual-vs-Strava dedup, entitlement caching staleness — all need cross-layer integration tests, not just unit tests.
- **Unchanged invariants:** Core Strava ToS posture (no raw stream redistribution, no off-platform sharing of athlete data) is invariant across all units. Auth identity (Supabase user UUID) is the canonical user ID across entitlements, RevenueCat, and Strava token storage.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AI plan quality below trust threshold at launch | Med | High | Eval harness (Unit 3.1) ships before generation; coach-graded reference plans; pilot on coach alpha cohort first. |
| Strava webhook outage or rate-limit ceiling | Med | High | Nightly reconciliation pull as backstop; manual completion always available; "Powered by Strava" with status banner. |
| Free-tier insight cost balloon at scale | Med | Med | Daily per-athlete cap, prompt caching (~80% savings), small models, daily cost dashboard. |
| App Store rejection on AI training claims | Low | High | No medical/health claims; explicit disclaimer; consult Apple guidelines pre-submission. |
| Strava ToS interpretation on 200-activity backfill + storage | Med | High | Store summary fields only, reference URL for streams; explicit privacy policy section; have a "delete my Strava data" flow. |
| Cross-store entitlement bugs (family sharing, refunds) | Med | Med | RevenueCat handles most; daily reconciliation job to catch missed webhooks. |
| Realtime drops mid-edit on flaky mobile networks | Med | Med | Optimistic local edits + reconnect-and-refetch; conflict toast on out-of-band server changes. |
| Multi-step LLM pipeline latency frustrates first-plan UX | Med | Med | Show progressive loading state ("building your blocks… expanding weeks…"); 90s P95 SLO. |
| Single-region (US) hosting for EU users hits latency / regulatory issues | Med | Med | Document EU posture in privacy; Phase-2 plan to add EU region post-launch. |
| Coach buy-in low (no coach-side monetization in v1) | Med | Med | Position as "AI does the busywork"; track coach NPS; iterate on the editor based on alpha feedback. |

## Success Metrics

Carry forward from origin doc:
- AI quality: ≥80% generated plans pass eval before public launch.
- Activation: ≥60% new athletes connect Strava in onboarding.
- Adaptivity: ≥70% of paid athletes accept the weekly review (with or without edits).
- Conversion: free → paid ≥5% within 30 days for athletes with an event date set.
- Coach NPS: ≥30 in first 90 days for coaches with ≥3 editor sessions.

Add operational:
- Strava webhook → calendar update P95 < 5s end-to-end.
- Plan generation P95 < 90s.
- Insight latency P50 < 30s.
- LLM cost per active free user per month < target (set during Unit 5.5).

## Phased Delivery

- **Phase 1 (Weeks 1–3): Foundations.** Repo, hosting, auth, mobile + web shells. Closed-loop signup works end-to-end.
- **Phase 2 (Weeks 3–6): Athlete + Strava core.** Connect Strava, backfill, profile, complete workouts, see calendar. App is useful as a tracker even before AI.
- **Phase 3 (Weeks 5–9, parallel): AI plan core.** Eval harness first, then generation pipeline, then weekly review. Feature-flagged behind paid entitlement.
- **Phase 4 (Weeks 8–11): Coach + real-time.** Invite, edit, comment, propagate. Closed beta with alpha coaches.
- **Phase 5 (Weeks 10–14): Insights, reports, monetization, launch.** Free insights, paid reports, RevenueCat, paywall, App Store + Play Store submission.

Phases overlap deliberately — Phase 3's eval harness work can begin in Week 2 with the alpha coach cohort while Phase 1 finishes infra.

## Documentation Plan

- `docs/solutions/strava-webhook-dedup.md` after Unit 2.4.
- `docs/solutions/llm-plan-pipeline.md` after Unit 3.2 ships.
- `docs/solutions/eval-harness.md` after Unit 3.1.
- `docs/launch/*` runbooks per Unit 5.5.
- `docs/architecture.md` (one-pager refreshed at end of each phase).

## Operational / Rollout Notes

- Feature flags: `ai_plans_enabled`, `weekly_review_enabled`, `coach_invite_enabled`, `paid_reports_enabled` — all on by default in prod once their respective units ship and pass eval/QA. Flags exist for fast rollback only.
- Closed beta gating via TestFlight + Play internal track for ~6–8 weeks before public launch.
- Cost dashboard for LLM spend updated daily; alerts at 1.5× projected.
- Strava API monitoring: 429 rate, webhook arrival lag, hydration failures.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-02-ai-endurance-training-app-requirements.md](../brainstorms/2026-05-02-ai-endurance-training-app-requirements.md)
- External research: see "External References" section above.
- No related PRs/issues — greenfield repo.
