---
date: 2026-05-16
topic: strava-phase-c-backfill
---

# Strava Phase C — Backfill + User-Facing Progress

## Problem Frame

An athlete who connects Strava via Phase B currently sees a static "Backfill in progress — Phase C lands the progress indicator" placeholder, and there is no backend doing the import. Phase C must:

1. Run the backfill (paginate the athlete's last 200 Strava activities, normalize, persist to `completed_workouts` + `strava_raw_payloads`).
2. Surface backfill state to the athlete on mobile, including a live progress indicator and recovery affordances when something goes wrong.

Phase C makes the Strava connection feel real for the athlete — when they leave the connect screen, they should see their history populating, and if anything fails they have a clear path back.

## Requirements

- **R1.** On `backfill.start` event (enqueued by Phase B's connect route), the system paginates the connected athlete's last 200 Strava activities (or fewer if they have less history), normalizes each, and writes rows to `completed_workouts` and raw payloads to `strava_raw_payloads`.
- **R2.** Backfill state is persisted to `athlete_profiles.backfill_status` (per-provider JSONB) and transitions through `queued → in_progress → complete` on success, or terminates in `failed` / `needs_reauth` on error.
- **R3.** The mobile Strava section shows live backfill progress (count of activities imported and current state) while the screen is open. The display reads from `backfill_status` and updates as the backend progresses.
- **R4.** On the terminal `complete` state, the mobile display flips to a "Connected — N activities imported" state silently (no push notification, no in-app banner outside the Strava section).
- **R5.** Transient backfill failures are absorbed by Inngest's built-in exponential backoff retries before any failure surfaces to the athlete. Only after backend retries are exhausted does the state become `failed`.
- **R6.** When state is `failed`, the mobile screen shows a **Retry import** button. Tap re-enqueues `backfill.start` for the athlete via a server endpoint that bypasses the OAuth path.
- **R7.** When state is `needs_reauth` (refresh token revoked or scopes changed), the mobile screen shows a **Reconnect Strava** button that re-runs the full Phase B OAuth flow. Distinct copy and CTA from the `failed` retry path.
- **R8.** Every backfill failure path (transient retries, terminal `failed`, `needs_reauth`, rate-limit pauses) emits a structured log entry containing at minimum: `user_id`, `event` (e.g., `backfill_failed`, `backfill_needs_reauth`, `backfill_rate_limited`), normalized error code, and attempt count. No tokens or raw Strava error bodies in logs.

## Success Criteria

- An athlete connecting Strava on a real device sees the progress count tick up from 0 to ~200 within a few minutes, then flip to "Connected — N activities imported" without further interaction.
- An athlete who revokes Strava access (or whose refresh token is invalidated) sees the `needs_reauth` state with a working Reconnect CTA the next time they open the Strava section.
- A simulated mid-backfill failure (network blip, 5xx) is absorbed by Inngest retries and never surfaces to the athlete.
- After Inngest retries are exhausted, the athlete sees the `failed` state with a working Retry button.
- All failure paths produce greppable structured logs sufficient to diagnose a stuck backfill from Vercel logs alone.
- After a successful backfill, `completed_workouts` contains the expected rows and `strava_raw_payloads` contains the corresponding `kind='hydration'` archives.

## Scope Boundaries

- **No push notifications** (local or server-side) on backfill completion. Done state is in-app, surfaced only on the Strava section.
- **No server-side alerting** (Sentry, Slack, PagerDuty) for backfill failures in Phase C — structured logs only. Revisit when failure rates become observable.
- **No disconnect flow.** The "Disconnect Strava" UI affordance remains out of scope (parent schema plan Unit 10 covers account deletion cascade). The disconnect-then-reconnect behavior is not specified here.
- **No ETA / time-remaining display** on the progress indicator. Count only ("142 of ~200 imported"). ETA is a polish item for later.
- **No backfill window beyond last 200 activities** — extended history, sport-specific filters, or date-range backfills are explicitly v2.
- **No webhook / live sync** — Phase D handles ongoing activity ingestion. Phase C imports the snapshot at connect time only.
- **No mid-backfill cancel** — once started, backfill runs to completion (or terminal failure). User can't abort.

## Key Decisions

- **Phase C ships the full user-facing flow, not just the backend.** Backend (C1+C2) plus live progress indicator (C3), Retry button (C4), and Reconnect CTA wiring (C5 — reuses Phase B machine). Rationale: shipping backend-only leaves the static placeholder live in production indefinitely, which feels broken to users who just connected.
- **Failure recovery = backend auto-retry + manual button after exhaustion.** Inngest's exponential backoff handles transients; the athlete only sees `failed` when backend has truly given up. The manual Retry button is the escape hatch — without it, a stuck athlete has no way back short of disconnecting (which doesn't exist yet anyway).
- **`needs_reauth` gets a distinct CTA from `failed`.** The user actions are different: `failed` re-enqueues; `needs_reauth` re-runs OAuth. Same button copy would hide that and produce a confusing flow when a Retry tap actually opens the Strava authorize page.
- **Done signal is silent (in-app only).** No push infrastructure in Phase C — that's net-new plumbing (expo-notifications, APNs/FCM, push-token table) that the project doesn't have yet. Defer until there's a second push use case to justify the cost.
- **200-activity backfill scope confirmed (R2 from product requirements unchanged).** This is the existing product commitment from the original brainstorm and should not be re-scoped in Phase C.
- **No `MEMORY.md` or memory writes for this brainstorm.** All decisions are project-state, captured in this document and the implementation plan.

## Dependencies / Assumptions

- Phase B is shipped and the connect route emits `backfill.start` events (assumption: PR #62 + #63 cover this — verify during planning).
- Inngest dev server + production app are configured and the function registry pattern from Phase A is in place.
- `athlete_profiles.backfill_status` column doesn't exist yet; C1 adds it via migration `0009_athlete_profiles_backfill_status.sql`.
- The mobile Strava section's existing reducer/state machine (from B3) can absorb new states (`in_progress` with count, `failed`, `needs_reauth`, `complete`) without a full rewrite.
- Mobile transport for live `backfill_status` updates (Supabase Realtime subscription vs. polling) is a planning-level technical decision — both satisfy R3.

## Outstanding Questions

### Resolve Before Planning

_(none — planning can proceed)_

### Deferred to Planning

- [Affects R3][Technical] Mobile transport for `backfill_status` updates — Supabase Realtime subscription vs. interval polling vs. focus-based refetch. Realtime is cleaner but requires the table to be in the realtime publication; polling is simpler. Planning to pick based on existing Realtime setup state.
- [Affects R6][Technical] Retry endpoint shape — `POST /api/integrations/strava/backfill/retry` with JWT-bound auth, no body. Idempotency / debounce policy (don't let a user spam the button into queuing N concurrent backfills) is a planning detail.
- [Affects R7][Technical] Whether the Reconnect CTA invokes the same `useReducer` path as the initial Connect, or a distinct "reconnect" entry point. Probably the same — but UI copy diverges.
- [Affects R1, R2][Needs research] Confirm Strava ToS / API agreement permits the 200-activity historical backfill. The original requirements doc flagged this — still unresolved. Planning should verify before C2 ships; if Strava limits us to N<200, R1 narrows and copy needs updating.
- [Affects R8][Technical] Log shape / namespace convention — pick one consistent prefix (e.g., `strava.backfill.*`) so a single grep surfaces all events.
- [Affects R3, R4][Technical] How the progress indicator handles the case where the user leaves the Strava section mid-backfill and returns later — does it re-subscribe and catch up from `backfill_status`, or refetch on focus? Probably both; planning to pin.
- [Affects R5][Technical] Inngest retry tuning — max attempts, backoff schedule, dead-letter handling. Inngest's defaults are usually fine; planning confirms.

## Next Steps

→ `/ce:plan` for structured implementation planning
