---
title: Inngest Setup (Local Dev + Production)
date: 2026-05-13
status: active
---

# Inngest Setup

Why Inngest, how the serve handler is wired, how local-dev events flow,
and the v1 testing posture for Inngest functions.

## Why Inngest

Per AGENTS.md "Background jobs", anything long-running (LLM plan
generation, Strava backfill of 200 activities, weekly review jobs) goes
through a queue layer rather than being awaited inside an HTTP handler.
Unit 1.5 of the parent product plan listed Inngest as the default
candidate; the Strava integration plan committed to it.

Trade-offs we accepted:

- External SaaS dep (alternative: QStash, Supabase Edge Functions + pg_cron).
  Migration path documented in the parent plan.
- A second local-dev process (`inngest-cli dev`) alongside `next dev`.
- Inngest-SDK-specific testing primitives (`@inngest/test`) replace the
  general "run my function with these inputs" pattern.

## Where the code lives

- `apps/web/src/inngest/client.ts` — the singleton `Inngest` instance.
  All event sends and all function definitions reference it.
- `apps/web/src/inngest/functions/index.ts` — registry of functions served
  by this app. Phase A bootstraps it empty; Phase C/D adds backfill,
  hydration, and matcher functions.
- `apps/web/app/api/inngest/route.ts` — the Next.js Route Handler that
  Inngest cloud (or local dev) talks to. Exposes `GET`, `POST`, `PUT`.
- `apps/web/package.json` — `inngest` runtime dep + `inngest-cli` devDep
  (the local dev server).
- `apps/web/.env.example` — documents `INNGEST_EVENT_KEY` and
  `INNGEST_SIGNING_KEY`.

## Local dev

Three terminals:

```bash
# Terminal 1: Supabase Postgres + Studio
supabase start

# Terminal 2: Next.js (serves the route handler at /api/inngest)
cd apps/web && pnpm dev

# Terminal 3: Inngest dev server (auto-discovers /api/inngest)
cd apps/web && pnpm dev:inngest
```

The Inngest dev server runs on port 8288 by default and serves a UI for
inspecting events, function runs, retries, and dead-letter queues. With
the dev server running, `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` can
stay empty — the SDK auto-discovers the dev endpoint.

To verify the wiring without running a real function, hit:

```bash
curl http://localhost:3000/api/inngest
```

The serve handler returns introspection JSON listing zero registered
functions during Phase A, then grows as Phase C and D register theirs.

## Production

- `INNGEST_EVENT_KEY` — from https://app.inngest.com (used to dispatch
  events).
- `INNGEST_SIGNING_KEY` — from the same dashboard. The serve handler
  (`apps/web/app/api/inngest/route.ts`) passes it to `serve()` and the
  client wires it on the `Inngest` instance so both inbound verification
  and outbound dispatch see the same value.
- Both go in Vercel env vars. The `apps/web/src/config.ts` validator
  **warns** (does not throw) when either is missing in production. We
  warn instead of refusing to boot because the Inngest SDK surfaces a
  clearer error on the first event dispatch (event key) or first inbound
  invocation (signing key); a hard boot failure for an unrelated
  subsystem has disproportionate blast radius. The warnings show up in
  Vercel build logs immediately so misconfig is visible before a
  customer-facing failure.

  Without `INNGEST_SIGNING_KEY` the serve handler operates in dev mode
  and accepts unsigned requests — fine locally, never fine in production.
  Watch the boot-time warning to catch the misconfig.

## v1 testing posture

- **Unit-style:** use `@inngest/test` (mentioned in the integration plan)
  to invoke a function with a fabricated event payload, assert the steps'
  outputs, and verify side-effects against a real local Postgres (the
  same harness `apps/web/src/db/__tests__/setup.ts` uses).
- **Integration:** run the Inngest dev server against `next dev` and a
  real Supabase instance, dispatch the event from a test, and assert the
  database final state. Heavier; reserve for end-to-end checks that gate a
  phase merge.
- **CI:** Phase A does not run Inngest in CI. Functions arrive in Phase C
  (backfill) with their own tests. The `@inngest/test` route is preferred
  in CI because it doesn't need the dev-server process.

## Why an empty `functions` array in Phase A

The plan's foundation phase ships scaffolding only. Registering zero
functions today proves the wiring (serve handler responds to the SDK's
introspection ping, types compile, dev server connects) without coupling
the Phase A PR to backfill/webhook logic that arrives in subsequent
phases. New functions append to the array as they land.

## Failure modes worth knowing

- **Stale signing key in production:** Inngest returns 401 on every
  function invocation. Rotation is the same `git`-flow as any other env
  var — update Vercel, redeploy.
- **Dev server not running:** `inngest.send(...)` calls silently no-op
  rather than throwing in development. Workflow: open the dev-server UI
  before testing; absence of expected events there is the signal.
- **Function registration drift:** if `inngest/functions/index.ts` exports
  a function but the dev server doesn't show it, the Next.js process
  hasn't reloaded since the file changed. Restart `next dev` (or use the
  HMR refresh once the route handler is served).
