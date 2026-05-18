---
title: Lazy on-view enrichment of Strava workouts
type: solution
date: 2026-05-18
status: shipped
---

# Lazy on-view enrichment of Strava workouts

This doc captures the architecture used to enrich a `completed_workouts` row
with Strava data beyond the initial backfill — lap splits, zone-time
distributions, normalized power, kJ, max watts, calories, and computed
IF/TSS — without violating the Strava ToS posture (no persisted 1Hz streams)
and without exhausting the 1000-call/day API budget.

## Where the code lives

- **Service:** `apps/web/src/strava/hydrate-workout.ts` — single
  `hydrateStravaWorkout()` function called from both the manual sync
  route and the auto-trigger.
- **Typed endpoints:** `apps/web/src/strava/endpoints.ts` —
  `fetchActivityLaps`, `fetchActivityZones`, `fetchAthleteZones` plus
  `deriveFtpFromZones` / `deriveHrMaxFromZones`.
- **Manual sync route:** `apps/web/app/api/integrations/strava/sync-workout/route.ts`.
- **Auto-trigger:** inline in the workout detail page server component
  at `apps/web/app/(athlete)/athlete/workouts/[id]/page.tsx`
  (`shouldHydrate` + `hydrateWithTimeout`).
- **Storage projection:** `apps/web/src/strava/build-summary-stats.ts` —
  shared between backfill, sync, and hydration.
- **Schemas:** `apps/web/src/strava/schemas.ts` — Zod schemas for the
  three new endpoints + new fields on `StravaActivitySchema`.
- **Math:** `apps/web/src/lib/training-math.ts` — pure `computeIF` /
  `computeTSS`.
- **Brainstorm:** `docs/brainstorms/2026-05-18-strava-workout-enrichment-requirements.md`.
- **Plan:** `docs/plans/2026-05-18-002-feat-strava-workout-enrichment-plan.md`.

## The four big decisions

### 1. No new column, JSONB only

The enriched data — laps array, zones array, derived ftp/hr-max/tss/IF,
plus a `hydrated_at` marker — all lands in the existing
`completed_workouts.summary_stats` JSONB column. Zero migration. The
existing renderer reads from `summary_stats` by key so new fields just
appear once the row is updated.

Why: avoids a migration review surface for a feature that's UI-only at
the data layer, and matches the prior brainstorm's
(`docs/brainstorms/2026-05-17-strava-data-surface-requirements.md` R3)
explicit decision to use JSONB for the wide set of detail fields Strava
exposes.

### 2. Lazy-on-view, not backfill

Backfill already pulls one Strava credit per activity. Adding /laps +
/zones + /athlete/zones during backfill would triple the per-activity
cost (300 credits + paging for 200 activities = over the daily 1000
cap for any athlete with >300 activities).

Instead, the auto-trigger runs inline in the workout-detail server
component on first view: `shouldHydrate` checks `summary_stats.hydrated_at
== null`, and if it's null and the workout is a Strava-sourced GPS sport
the page awaits `hydrateStravaWorkout` (5-second hard cap via
`Promise.race`). The result amortises the 3 credits across actual
usage — a user who never opens an old workout never costs us those
credits.

### 3. Snapshot derived metrics, don't re-compute

`FTP`, `HR-max`, `intensity_factor`, and `tss` are derived from
`/athlete/zones` + `weighted_average_watts` + duration. We store the
derived primitives directly on `summary_stats` at hydration time rather
than re-computing at render time. Two reasons:

1. **Historic stability** — when an athlete's FTP changes later, the
   TSS reading on a 6-month-old workout should reflect the FTP *at the
   time* of the workout, not now.
2. **No render-time athlete-profile read** — pages don't have to join
   to `/athlete/zones` or cache it separately.

This is the more interesting half of the architecture. The original
plan had us caching `/athlete/zones` on `athlete_profiles.manual_fields`
with a 7-day TTL; we dropped that because (a) writes to `manual_fields`
trip a lockstep trigger (migration `0005`) that's meant for
user-edited fields, and (b) snapshotting derived values onto the
workout row itself is simpler and more correct.

### 4. Partial-failure tolerance via `Promise.allSettled`

The detail endpoint is must-succeed (no row update without it). The
three enrichment calls (/laps, /zones, /athlete/zones) wrap individually
in `Promise.allSettled` so a transient 5xx on /zones does NOT discard
a successful detail fetch. Each endpoint's contribution becomes `null`
on rejection and `mergeEnrichment` simply omits the key.

This caught a P1 review finding — the original implementation used
`Promise.all` for all four, which would have made any single Strava
hiccup re-trigger hydration on every page view (since the row never
got `hydrated_at` stamped) and burn credits forever.

## Concurrency + retry posture

Three failure modes the implementation guards against:

| Failure | Guard | Where |
|---|---|---|
| Two parallel page renders both trigger hydration | UPDATE has `.is("summary_stats->>hydrated_at", null)` — second writer is a no-op and re-reads the row | `hydrate-workout.ts` |
| 5-second timeout fires while Strava request still in-flight | Same UPDATE guard — when the late request resolves it sees `hydrated_at IS NOT NULL` and no-ops | `hydrate-workout.ts` |
| Rate-limit / reauth / transient failure causes repeated retry storms | Stamp `summary_stats.hydrate_error_at` on failure; `shouldHydrate` skips for 10 min | `page.tsx` |

There's a deliberate gap: the AbortController plumbing to actually
cancel in-flight Strava requests on timeout doesn't exist yet. The
late-write guard makes it safe to skip; the cost is that a slow
Strava upstream still consumes its credit budget. Add the AbortSignal
threading if 429 storms become observed pain.

## What's intentionally not implemented

- **`/streams` (1Hz HR/power/pace samples)** — explicitly forbidden by
  migration `0008` per Strava ToS R18. The design's interactive
  performance-over-time chart is therefore not built. A future
  re-interpretation could enable a render-only (never persisted)
  variant; that decision is out of scope here.
- **Weather** — Strava doesn't reliably expose it. Would need a
  separate weather API (Visual Crossing / OpenWeather) keyed on
  location + timestamp.
- **AI coach takeaway / RPE / notes** — separate concerns, separate
  brainstorms.
- **Backfill enrichment** — see Decision 2.

## Pattern to reuse elsewhere

The "lazy on-view enrichment with negative-cache" pattern is general:

```
shouldHydrate(row) := needs_enrichment(row) && !recent_failure(row)

if shouldHydrate(row):
  enriched = await Promise.race([
    hydrate(row),
    timeout(N seconds)
  ])
  if enriched:
    render(enriched)
  else:
    stamp_failure(row)
    render(stale)
```

Anywhere we have user-facing rows enriched by a slow / rate-limited
third party (other fitness providers, weather, geocoding, AI
inference), this is the same shape. The negative cache is the part
people forget; without it a flaky upstream takes down your page.
