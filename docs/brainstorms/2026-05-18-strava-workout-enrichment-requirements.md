---
date: 2026-05-18
topic: strava-workout-enrichment
---

# Strava Workout Enrichment — Power, Zones, and Laps

## Problem Frame

The redesigned workout-detail page (shipped at commit `895cf88`) renders an
editorial hero, a sport-coloured headline metric grid, an adaptive secondary
stats grid, and a map card. Most of the design's deeper sections —
**Zone Distribution**, **Lap Splits**, and richer hero metrics like
Normalized Power, kilojoules, max watts, calories, IF/TSS — are dark because
the data is not on disk yet.

Strava already has all of these aggregates available via API calls we are
**not** currently making. Backfilling them does not violate the project's
Strava ToS posture (raw 1Hz stream samples remain forbidden; the new data
is all summary aggregates). This brainstorm scopes the enrichment so
planning can execute without re-deciding scope, ToS posture, or rate-limit
strategy.

## Prior Art

- `docs/brainstorms/2026-05-17-strava-data-surface-requirements.md` maps the
  full Strava data surface, marks rich-detail extraction (R1–R3) and laps
  (R5) as "ready to ship," and explicitly defers zones (R7) until a UI
  exists. **That UI now exists** — the design's `ZoneDistribution` and
  `LapSplits` components are spec'd and the visual chrome has shipped.
  This brainstorm is the trigger to execute R1–R5 + R7.
- `docs/brainstorms/2026-05-17-workout-detail-page-requirements.md` is
  superseded on the "no map" point — the team revised the ToS
  interpretation when it shipped the polyline-based Leaflet map. **Raw
  1Hz streams remain forbidden** per migration `0008` and
  `apps/web/src/strava/schemas.ts` comment block; summary polyline,
  summary zones, and lap aggregates are allowed.

## Requirements

**Detail extraction (no extra API calls)**

- R1. Extend `StravaActivitySchema` in `apps/web/src/strava/schemas.ts` to
  capture every product-valuable non-stream field from `GET /activities/{id}`:
  `description`, `calories`, `weighted_average_watts`, `kilojoules`,
  `max_watts`, `elev_high`, `elev_low`, `average_temp`, `device_watts`,
  `has_heartrate`, `trainer`, `commute`, `manual`, `pr_count`,
  `achievement_count`, `start_date_local`, `utc_offset`. (All listed in
  the prior data-surface brainstorm.)
- R2. Persist the new numeric/bool/string fields in the existing
  `summary_stats` JSONB column. No new column. Match the existing
  `buildStats` / `buildSummaryStats` helper pattern.
- R3. Surface the most useful new fields in the redesigned hero:
  - `weighted_average_watts` → "Normalized Power" in the secondary grid
  - `kilojoules` → "Energy" in the secondary grid
  - `max_watts` → "Max Power" in the secondary grid
  - `calories` → "Calories" in the secondary grid (when present)
  - `device_watts === false` → small "estimated" annotation on Avg Power
    (prevents passing estimated power off as measured)
- R4. The hero must compute and display **Intensity Factor (IF)** and
  **Training Stress Score (TSS)** when both `weighted_average_watts` and
  the athlete's FTP are available. Formulas:
  - `IF = NP / FTP`
  - `TSS = (duration_s × NP × IF) / (FTP × 3600) × 100`
  These are computed at render time — not stored — so the source of truth
  stays the underlying primitives.

**Lap splits (1 extra API call, lazy)**

- R5. Fetch `GET /activities/{id}/laps` lazily the first time a workout
  detail page is opened, and **only** when the workout is sport-eligible
  (bike, run, swim) and Strava-sourced. Persist the response into
  `summary_stats.laps` as an array of per-lap aggregates (lap_index,
  elapsed_time, moving_time, distance, average_speed,
  average_heartrate, max_heartrate, average_cadence, average_watts,
  total_elevation_gain).
- R6. The detail page renders a "Lap Splits" section (matching the
  design's `LapSplits` component) when `summary_stats.laps` is present
  and non-empty. Otherwise the section is omitted entirely — no empty
  state needed.

**Zone distribution (1 extra API call, lazy)**

- R7. Fetch `GET /activities/{id}/zones` lazily on the same trigger as
  R5. Strava returns an array per zone type (`heartrate`, `power`) where
  each entry has a bucket `min` / `max` and a `time` in seconds. Persist
  the entire response into `summary_stats.zones` as-is — Strava already
  shapes it correctly.
- R8. The detail page renders a "Zone Distribution" section (matching
  the design's `ZoneDistribution` component) when `summary_stats.zones`
  contains either a power or HR breakdown. Render both side-by-side
  when both exist; render the single available one full-width
  otherwise.

**Athlete FTP & HR-max (1 API call per session, cached)**

- R9. Fetch `GET /athlete/zones` once per athlete session and cache the
  result onto `athlete_profiles.manual_fields.strava_zones`. This gives
  us the athlete's configured FTP (power zones) and HR max — needed for
  R4 (IF/TSS computation) and for proper zone labelling in R8. Refresh
  if the cached value is older than 7 days.

**Hydration trigger model**

- R10. The lazy-hydration trigger is the existing
  `POST /api/integrations/strava/sync-workout` route, extended to also
  call `/laps`, `/zones`, and (if stale) `/athlete/zones`. The route
  is already wired to the "Sync from Strava" button in the workout
  detail topbar, so users get an explicit refresh path.
- R11. A new server action runs the same hydration **automatically on
  first view** when `summary_stats.laps` or `summary_stats.zones` is
  absent. Triggered from the server component during page render,
  awaited inline (the page is dynamic anyway), with a 5-second hard
  cap — on timeout or any Strava error, render the page without the
  enriched sections rather than blocking.
- R12. The backfill flow (`apps/web/src/inngest/functions/backfill-strava.ts`)
  is **not** extended to fetch laps/zones. Backfill already pulls 200
  activities × 1 credit; adding 3 credits/activity would burn the
  1000/day quota for any athlete with >300 activities. Lazy-on-view
  amortises the cost across actual usage.

## Success Criteria

- A bike workout with power data shows Normalized Power, Energy (kJ),
  Max Power, and computed TSS / IF in the hero's secondary grid the
  first time the page is loaded after deploy.
- The same workout shows a Zone Distribution section with power and
  HR breakdowns by the second page load (after lazy hydration).
- The same workout shows a Lap Splits section listing every Strava
  lap (warm-up, work reps, recoveries, cool-down) on the second load.
- A run workout shows pace-relevant stats (heart-rate zones, pace
  laps) but does not show power-only fields.
- A workout where Strava returns 429 or 5xx during lazy hydration
  still renders the original page within 5 s — no user-visible
  failure beyond "section not yet available."
- No new daily Strava credit cost on backfill. Per-user credit cost on
  workout detail view: 3 credits the first time, 0 thereafter.

## Scope Boundaries

- **No raw 1Hz streams.** The design's "Performance over time"
  interactive chart (Power/HR/Cadence/Speed scrub) is **not**
  implemented in this scope. Persisting `/streams` violates migration
  `0008`'s explicit prohibition; a future ToS reinterpretation could
  enable an on-demand-render-only variant, but that decision is out of
  scope here.
- **No weather.** Strava does not reliably surface weather. Adding a
  separate weather API (Visual Crossing, OpenWeather) is out of scope.
- **No AI coach takeaway.** Separate concern, separate brainstorm.
- **No RPE / notes editor.** User-entered data, requires new column +
  write path, separate brainstorm.
- **No backfill enrichment.** Lazy-on-view only. Athletes with old
  workouts will accumulate enriched data as they browse.
- **No athlete-stats endpoint.** `GET /athlete/stats` (lifetime/YTD
  totals) was R6 of the prior brainstorm and remains deferred — it
  serves dashboard cards, not the workout detail page.

## Key Decisions

| Decision | Rationale |
|---|---|
| **Lazy-on-view for laps/zones, not backfill** | 3× rate cost during backfill is unaffordable; lazy amortises across actual usage |
| **Persist to `summary_stats` JSONB, no new columns** | Matches prior brainstorm's R3; zero migration risk; easy to evolve |
| **Compute IF/TSS at render, don't store** | Both are derived from NP + FTP; storing creates drift when FTP changes |
| **Cache `/athlete/zones` for 7 days** | FTP doesn't change daily; weekly refresh is plenty |
| **First-view auto-hydration with 5s cap** | Users shouldn't have to click "Sync" to see zones; but Strava outages mustn't block the page |
| **Skip `/streams` permanently in this scope** | Policy boundary in migration `0008` is unambiguous; revisiting it is a separate decision |
| **`name` stays in `summary_stats`** | Prior brainstorm's R2 ("dedicated column for name") deferred — not blocking this work, and the existing renderer already handles it |

## Dependencies / Assumptions

- The existing Leaflet map renders `summary_polyline` and continues
  to do so — the redesigned `MapCard` wraps it unchanged.
- The Strava push webhook (`apps/web/app/api/integrations/strava/webhook/route.ts`,
  if it exists; otherwise just the manual sync route) is **not**
  modified in this scope. Sync still happens via the existing manual
  sync path; webhook-triggered enrichment can be added later.
- The existing `StravaClient` already handles rate-limit headers,
  token refresh, and 401 → reauth typed errors. New endpoints (`/laps`,
  `/zones`, `/athlete/zones`) reuse it as-is.
- Athletes without configured Strava zones get a graceful empty
  response from `/zones`. The renderer must handle this without
  errors.

## Outstanding Questions

### Resolve Before Planning

_None. All scope decisions are made above._

### Deferred to Planning

- [Affects R11][Technical] Where exactly does the lazy-hydration call
  live? Three candidates: (a) server component in `page.tsx` with an
  inline `await` and `Suspense` boundary; (b) a client-side `useEffect`
  in a new client component that POSTs to the sync route; (c) Inngest
  fire-and-forget. Planning should pick based on UX tradeoffs (initial
  render speed vs. data freshness on first paint).
- [Affects R9][Technical] What's the exact shape of `manual_fields.strava_zones`
  and how does the existing `lockstep_trigger` on
  `athlete_profiles.manual_fields` interact with cached automated data?
  Planning needs to verify that writing this key doesn't trip the
  edited-at lockstep semantics.
- [Affects R7][Needs research] What is Strava's exact response shape
  when an athlete has not configured zones? Empty array? Empty object?
  404? Planning should add a Zod schema for the response and verify
  against a real account.
- [Affects R5][Technical] How does the lazy-hydration server action
  handle the case where two parallel requests for the same workout
  arrive (e.g. user opens two tabs)? Need either a row-level lock,
  a "if-newer-than-N-seconds" guard, or accept the double-fetch and
  rely on the idempotent UPDATE.

## Next Steps

→ `/ce:plan` for structured implementation planning
