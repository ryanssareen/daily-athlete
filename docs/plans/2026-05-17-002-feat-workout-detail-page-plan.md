---
title: "feat: Add workout detail page (web + Flutter)"
type: feat
status: active
date: 2026-05-17
origin: docs/brainstorms/2026-05-17-workout-detail-page-requirements.md
---

# feat: Add Workout Detail Page (Web + Flutter)

## Overview

Build a read-only workout detail page on both Next.js (web) and Flutter that displays
sport-specific stats for completed workouts. The page is reached from three entry points
(dashboard, activities, calendar) with back navigation returning to the correct origin.
Two workout types — Strava-synced and manual — drive different layout variants based on
data availability.

## Problem Frame

Athletes need the full breakdown of a completed workout beyond the summary chip visible
in calendar/activity views. The detail page is the primary surface for Strava stat
exploration (HR, pace, power, elevation, effort) and manual workout review. The page
exists on both platforms and must handle sport-specific display without rendering empty
sections for missing data.
(see origin: docs/brainstorms/2026-05-17-workout-detail-page-requirements.md)

## Requirements Trace

- R1–R2: Back navigation via `?from=dashboard|activities|calendar` query param; fallback to Activities
- R3–R5: Header — workout name (sport label fallback if absent), date/time in athlete's local timezone, source badge (Strava / Manual Entry)
- R6–R8: Primary stats row — Duration always; Distance hidden for strength; Pace/Speed derived from distance+duration for applicable sports
- R9–R12: Strava Run — HR, elevation, relative effort, PR badge if pr_count > 0
- R13–R16: Strava Bike — same as run + power (with "Estimated" label if device_watts=false), indoor badge if trainer=true
- R17–R21: Strava Swim — distance in meters, stroke type if available (omit otherwise), HR, stroke rate (average_cadence), other swim fields
- R22–R25: Strava Strength — duration only; distance slot hidden; HR and relative effort if present
- R26–R28: Other sports — duration, distance, HR, elevation, generic key-value overflow
- R29–R32: Manual — logged fields only; coach notes if matched; "connect Strava" nudge only if not already connected
- R33: Overflow "More stats" section for unknown summary_stats keys (collapsed by default)
- R34–R35: Loading state (skeleton / spinner); error → navigate back to origin silently
- R36–R39: UTC storage, display in athlete's local timezone

## Scope Boundaries

- Read-only — no editing
- No GPS map — Strava ToS
- No lap splits in v1
- No social actions (kudos, comments)
- No share / export in v1
- Coach notes (R31) deferred — athlete layout already blocks coach access; implementing the `workout_matches` JOIN is a separate follow-up
- Strava data surface fields (`device_watts`, `trainer`, `pr_count`, `max_watts`, `has_heartrate`, `average_cadence`) are not yet stored — sections depending on them are hidden at launch and appear automatically once the Strava data surface expansion plan ships

## Context & Research

### Relevant Code and Patterns

**Web:**
- `apps/web/app/(athlete)/athlete/workouts/[id]/page.tsx` — stub; receives `params: Promise<{ id: string }>`
- `apps/web/src/db/workouts.ts` — `getRecentWorkouts` pattern; `WorkoutRow` type to extend
- `apps/web/app/(athlete)/athlete/activities/page.tsx` — `await searchParams` pattern in server component
- `apps/web/app/(athlete)/athlete/activities/loading.tsx` — skeleton pattern with `className="skeleton"`
- `apps/web/app/(coach)/athletes/[id]/page.tsx` — back nav via `<Link href="...">← Back</Link>`
- `apps/web/src/strava/backfill-helpers.ts` — `buildSummaryStats` writes to `summary_stats` JSONB
- `apps/web/src/auth/server.ts` — `createClient()` for JWT-forwarding Supabase client
- `packages/shared/src/users.ts` — `UserRow` with `timezone` IANA string field

**Flutter:**
- `daily-athlete/lib/router/router.dart` — GoRouter config, ShellRoute + 4 tab routes; `/activities/:id` route exists but incorrectly wired to `ActivitiesTab`
- `daily-athlete/lib/features/activities/activity_detail_screen.dart` — current screen (Navigator.push, GPS map widget to remove)
- `daily-athlete/lib/features/activities/activity_feed.dart` — calls `Navigator.push` (to replace with `context.push`)
- `daily-athlete/lib/models/completed_workout.dart` — `CompletedWorkoutRow`; `name` computed getter reads `summaryStats['name']`
- `daily-athlete/lib/features/athlete_dashboard/athlete_dashboard.dart` — canonical `dataAsync.when(loading:, error:, data:)` pattern
- `daily-athlete/lib/features/activities/activity_row.dart` — `sportIcon(Sport)` helper
- `daily-athlete/lib/features/workouts/workout_chip.dart` — `sportColor(Sport)` helper
- `daily-athlete/lib/features/settings/strava_connect_section.dart` — Strava connection state provider

**Shared:**
- `packages/shared/src/planned-workout.ts` — sport enum: `swim | bike | run | strength | mobility | other`
- `apps/web/src/strava/sport-normalization.ts` — Strava sport_type → canonical sport

### Institutional Learnings

- `supabase-dart .stream()` silently drops `.gte()` / `.lte()` filters — use `.select()` for the ID fetch (equality only, safe on either)
- All `completed_workouts` queries must add `.is("deleted_at", null)` — the partial unique index does not enforce this on reads
- `users.timezone` is the IANA timezone string; applied at the render boundary — never at storage time
- Do NOT copy `formatDate()` from the dashboard — it hardcodes `timeZone: "UTC"` (wrong for time-of-day display)
- `Navigator.push` outside GoRouter breaks Android back button and the bottom tab navigator
- `import "server-only"` must appear at the top of every file in `apps/web/src/db/`

### External References

None needed — local patterns are sufficient.

## Key Technical Decisions

- **Web loading state: skeleton over spinner** — Project convention is `loading.tsx` with `className="skeleton"` CSS blocks. Brainstorm R34 said "spinner" before the convention was known. Skeleton is used for web; `CircularProgressIndicator` is used for Flutter (where no skeleton convention exists).
- **Flutter `from` param: URI query param not `extra`** — GoRouter `extra` does not survive process kill + deep-link restore. Use `/activities/:id?from=activities`. Falls back to 'activities' if the param is absent.
- **Web error path: `redirect(backHref)` computed before DB fetch** — `backHref` is derived from `searchParams.from` at the top of the server component, before any async call. If `getWorkoutById` returns null (not found, deleted, superseded, or RLS denied), `redirect(backHref)` is called. No error screen, no toast (server components cannot show toasts).
- **`name` stored in `summary_stats.name`** — Until the Strava data surface expansion adds a dedicated `name` column, `buildSummaryStats` writes `activity.name` to `summary_stats['name']`. Flutter's `CompletedWorkoutRow.name` computed property already reads from there. Names are absent for pre-Unit-1 historical activities.
- **Missing Strava fields — sections hidden at launch** — `device_watts`, `trainer`, `pr_count`, `max_watts`, `has_heartrate`, `average_cadence` not yet stored. Sections R12, R14, R15, R16, R20 are hidden at launch. They render automatically once the Strava data surface expansion ships.
- **Timezone web: `users.timezone` from `getUserWithRoles()`** — The server component already calls `getUserWithRoles()`. If `timezone` is not already in the return type, add it. Pass to `formatWorkoutDateTime` which uses `Intl.DateTimeFormat([], { timeZone: timezone })`.
- **Timezone Flutter: `.toLocal()` for v1** — Device timezone approximation. IANA athlete timezone via the `timezone` package is deferred.
- **Swim units: respect `unitsNotifier.swimDistance` in Flutter; meters on web** — No unit preference system exists on web yet.
- **Null `duration_s`: show "—"** — Duration is nullable in the schema. R6 says "always show Duration" — interpret as always showing the Duration slot; render "—" if null.
- **Known key allowlist for R33 overflow** — See section below.

### Overflow Key Allowlist

Keys consumed by named sections are excluded from the "More stats" overflow. Keys in
`summary_stats` not listed below (per sport) appear in the overflow section:

```
ALL sports:   name, average_heartrate, max_heartrate, suffer_score,
              average_speed, max_speed
RUN:          + total_elevation_gain
BIKE:         + total_elevation_gain, average_watts, max_watts, device_watts,
                trainer, weighted_average_watts, kilojoules
SWIM:         + average_cadence
STRENGTH:     (only the ALL subset)
MOBILITY:     + total_elevation_gain
OTHER:        + total_elevation_gain
```

Human-readable label strategy: split camelCase and snake_case on word boundaries and
title-case the result (`averageHeartrate` → "Average Heartrate",
`total_elevation_gain` → "Total Elevation Gain").

## Open Questions

### Resolved During Planning

- **Swim stroke type (R18):** Strava `sport_type` for swimming is "Swim" — no stroke type exposed. R18's "if not available, omit" clause applies universally for v1.
- **GoRouter `extra` vs query param:** Use URI query param — `extra` does not survive cold restores.
- **Coach notes (R31) data path:** Deferred. Page is athlete-only; coach-scoped workout detail is a separate feature.
- **Web error redirect destination when `from` absent:** `/athlete/activities` as the default fallback.
- **Swim distance units:** Flutter respects `unitsNotifier.swimDistance`; web hardcodes meters.
- **Null `duration_s`:** Show "—" in the Duration slot.
- **Web error toast:** Server component cannot show a toast. Silent `redirect(backHref)` is the error path.

### Deferred to Implementation

- **`timezone` field in `getUserWithRoles()` return:** Verify it is present; add to query and `UserWithRoles` type if missing.
- **Exact FutureProvider vs AsyncNotifier for Flutter:** Follow `AthleteDashboard` pattern — `FutureProvider.autoDispose` keyed to `workoutId`.
- **Calendar and dashboard entry points in Flutter:** Unit 5 must ensure the calendar day-view and dashboard recent-workout taps use `context.push('/activities/$id?from=calendar')` and `?from=dashboard` respectively. Locate those call sites during implementation.
- **`flutter_map` / `latlong2` other consumers:** Run `grep -r "flutter_map\|latlong2" daily-athlete/lib` before removing from `pubspec.yaml`.
- **`hasStravaToken` server helper:** Check if a utility already exists in `apps/web/src/` for checking whether a user has a strava_tokens row; create a minimal one if not.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Web data flow:**

```
Page({ params: {id}, searchParams: {from} })   [Server Component]
  │
  ├─ backHref = mapFrom(from)        ← computed before any await
  ├─ await getUserWithRoles()        → userId + timezone; redirect('/sign-in') if null
  ├─ await getWorkoutById(supabase, userId, id)
  │     SELECT id, source, strava_activity_id, started_at, sport,
  │            distance_m, duration_s, summary_stats
  │     WHERE id=:id AND athlete_id=:userId
  │       AND deleted_at IS NULL AND superseded_by_id IS NULL
  │
  ├─ null → redirect(backHref)
  └─ data → WorkoutDetailView
        ├─ <Link href={backHref}>← {backLabel}</Link>
        ├─ Header  (name|sportLabel, formatWorkoutDateTime(started_at, timezone), sourceBadge)
        ├─ PrimaryStatsRow  (duration, distance?, pace/speed?)
        ├─ SportSections    (each conditional on summary_stats field presence)
        └─ OverflowSection  (keys not in per-sport allowlist; collapsed)
```

**Flutter data flow:**

```
GoRoute /activities/:id?from=activities
  → ActivityDetailScreen(workoutId: id, from: from ?? 'activities')
       ref.watch(workoutDetailProvider(workoutId))    [FutureProvider.autoDispose]
         ├─ loading  → Center(CircularProgressIndicator())
         ├─ error    → showSnackBar() then context.pop()
         └─ data     → WorkoutDetailBody
               ├─ Header (name ?? sportLabel, startedAt.toLocal(), sourceBadge)
               ├─ PrimaryStatsRow
               ├─ SportSections (conditional on summaryStats keys)
               └─ ExpansionTile("More stats", overflow keys)
```

**Sport section decision matrix:**

| Sport    | Distance | Pace/Speed  | HR | Elevation | Power | PR Badge | Stroke Rate |
|----------|----------|-------------|----|-----------|-------|----------|-------------|
| run      | km       | /km         | ✓  | ✓         | —     | ✓†       | —           |
| bike     | km       | km/h        | ✓  | ✓         | ✓†    | ✓†       | —           |
| swim     | m / yds  | /100m       | ✓  | —         | —     | —        | ✓†          |
| strength | hidden   | —           | ✓  | —         | —     | —        | —           |
| mobility | km       | —           | ✓  | ✓         | —     | —        | —           |
| other    | km       | —           | ✓  | ✓         | —     | —        | —           |

*✓ = show if data present.  ✓† = show if data present; field not yet stored — hidden at launch.*
*— = never shown for this sport.*

## Implementation Units

- [ ] **Unit 1: Add `name` to Strava summary_stats**

**Goal:** Write `activity.name` into `summary_stats` in `buildSummaryStats` so workout
names appear on the detail page without requiring a dedicated DB column migration.

**Requirements:** R3

**Dependencies:** None

**Files:**
- Modify: `apps/web/src/strava/backfill-helpers.ts`
- Test: `apps/web/src/strava/__tests__/backfill-helpers.test.ts` (create if absent)

**Approach:**
- In `buildSummaryStats`, after existing field assignments, add: if `activity.name` is
  a non-empty string, set `stats.name = activity.name`
- `StravaActivitySchema` already includes `name: z.string().default("")` — no schema change needed
- Empty-string guard prevents storing `name: ""` for Strava activities that have no title

**Patterns to follow:**
- Existing field assignments in `buildSummaryStats` (same file)

**Test scenarios:**
- Happy path: activity object with `name: "Morning Run"` → `buildSummaryStats` returns object where `stats.name === "Morning Run"`
- Edge case: activity with `name: ""` → returned stats object has no `name` key (or `name` is undefined/null, not stored)
- Edge case: activity with `name` field absent → returned stats object has no `name` key

**Verification:**
- A Strava activity run through `buildSummaryStats` with a name has `summary_stats.name` equal to the name
- An activity with an empty name does not pollute `summary_stats` with an empty string

---

- [ ] **Unit 2: Web DB — `getWorkoutById` and `WorkoutDetailRow` type**

**Goal:** Add the data-fetching function and return type needed by the detail page,
including `summary_stats` and proper exclusion of soft-deleted / superseded rows.

**Requirements:** R3, R6, R7, R9–R33

**Dependencies:** None

**Files:**
- Modify: `apps/web/src/db/workouts.ts`
- Test: `apps/web/src/db/__tests__/workouts.test.ts` (create if absent)

**Approach:**
- Define `WorkoutDetailRow` interface: extends the core workout columns with
  `summary_stats: Record<string, unknown>` and `strava_activity_id: number | null`
- `getWorkoutById(supabase: SupabaseClient, athleteId: string, id: string): Promise<WorkoutDetailRow | null>`:
  - `.select('id, athlete_id, source, strava_activity_id, started_at, sport, distance_m, duration_s, summary_stats')`
  - `.eq('id', id).eq('athlete_id', athleteId).is('deleted_at', null).is('superseded_by_id', null).maybeSingle()`
  - Throw on Supabase error; return `null` on not-found
  - RLS policy `completed_workouts_self_select` enforces ownership; the `athleteId` filter is an explicit defense-in-depth layer
- `import "server-only"` is already at the top of the file — do not remove it
- Access `summary_stats` fields downstream with optional chaining and explicit casts:
  `(row.summary_stats?.average_heartrate as number | undefined)`

**Patterns to follow:**
- `getRecentWorkouts` in same file — structure, error handling, `.is("deleted_at", null)` filter

**Test scenarios:**
- Happy path: ID + athleteId match a non-deleted, non-superseded row → returns `WorkoutDetailRow` with `summary_stats` populated
- Edge case: row exists but `athlete_id` does not match → returns `null`
- Edge case: row exists but `deleted_at` is not null → returns `null`
- Edge case: row exists but `superseded_by_id` is not null → returns `null`
- Edge case: ID does not exist → returns `null`
- Error path: Supabase client returns an error → function throws

**Verification:**
- TypeScript compiles without error
- Each exclusion case returns null in tests
- `getRecentWorkouts` and `getWorkoutsInRange` are unchanged

---

- [ ] **Unit 3: Web display utilities**

**Goal:** Provide canonical formatting functions for the detail page — duration, distance,
pace, and workout date/time with timezone — and extract duplicated sport display helpers
into a shared module.

**Requirements:** R3, R4, R6, R7, R8

**Dependencies:** None

**Files:**
- Create: `apps/web/src/lib/sport-display.ts`
- Create: `apps/web/src/lib/format.ts`
- Test: `apps/web/src/lib/__tests__/format.test.ts`
- Test: `apps/web/src/lib/__tests__/sport-display.test.ts`

**Approach:**

`sport-display.ts` — extract from duplicated code in dashboard, activities, calendar, coach pages:
- `getSportEmoji(sport: Sport): string`
- `getSportColor(sport: Sport): string`
- `getSportLabel(sport: Sport): string` (e.g., `'run' → 'Run'`, `'strength' → 'Strength'`)

`format.ts` — new formatting functions:
- `formatDuration(seconds: number | null): string`
  — `h:mm:ss` if ≥ 3600 s, else `m:ss`; returns `"—"` if null
- `formatDistance(meters: number | null, sport: Sport): string`
  — convert to km (2 decimal places) for non-swim sports; display as meters for swim; return `"—"` if null
- `formatPace(meters: number | null, seconds: number | null, sport: Sport): string | null`
  — seconds per km for run; seconds per 100 m for swim; km/h (1 decimal) for bike
  — returns `null` if meters or seconds is null or zero
- `formatWorkoutDateTime(startedAt: string, timezone: string): string`
  — parses UTC ISO string, formats as `"May 12 · 7:14 AM"` in the given IANA timezone
  — uses `Intl.DateTimeFormat` with `{ timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }`

These are pure functions — no I/O, no server-only boundary needed.

**Patterns to follow:**
- `getSportEmoji` in `apps/web/app/(athlete)/athlete/page.tsx` (source to extract from)

**Test scenarios:**
- `formatDuration(3661)` → `"1:01:01"`
- `formatDuration(90)` → `"1:30"`
- `formatDuration(0)` → `"0:00"`
- `formatDuration(null)` → `"—"`
- `formatDistance(5000, 'run')` → `"5.00 km"`
- `formatDistance(1500, 'swim')` → `"1500 m"`
- `formatDistance(null, 'run')` → `"—"`
- `formatPace(5000, 1500, 'run')` → seconds-per-km pace string (300 s/km → `"5:00 /km"`)
- `formatPace(1500, 1800, 'swim')` → seconds-per-100m string (120 s/100m → `"2:00 /100m"`)
- `formatPace(20000, 3600, 'bike')` → km/h string (`"20.0 km/h"`)
- `formatPace(null, 1800, 'run')` → `null`
- `formatWorkoutDateTime('2026-05-12T14:14:00Z', 'America/New_York')` → `"May 12 · 10:14 AM"`
- `formatWorkoutDateTime('2026-05-12T14:14:00Z', 'UTC')` → `"May 12 · 2:14 PM"`

**Verification:**
- All format function test scenarios pass
- TypeScript compiles without error
- No existing callers of the old duplicated helpers are broken (callers not yet migrated)

---

- [ ] **Unit 4: Web workout detail page**

**Goal:** Implement the full server-component detail page with back navigation, sport-specific
sections, source badge, loading skeleton, and silent-redirect error handling.

**Requirements:** R1–R33 (web surface), R34–R35 (web), R36–R39 (web)

**Dependencies:** Units 2, 3

**Files:**
- Modify: `apps/web/app/(athlete)/athlete/workouts/[id]/page.tsx`
- Create: `apps/web/app/(athlete)/athlete/workouts/[id]/loading.tsx`

**Approach:**

`page.tsx` — async server component:
1. `const { id } = await params`; `const { from } = await searchParams`
2. Compute `backHref` immediately (before any DB call):
   `from === 'dashboard'` → `/athlete`, `from === 'calendar'` → `/athlete/calendar`, else → `/athlete/activities`
   Compute `backLabel` similarly: `'← Dashboard'`, `'← Calendar'`, `'← Activities'`
3. `await getUserWithRoles()` → redirect to `'/sign-in'` if null; destructure `{ id: userId, timezone }`
4. `await createClient()` then `await getWorkoutById(supabase, userId, id)` → `redirect(backHref)` if null
5. Optionally `await hasStravaToken(supabase, userId)` for the manual nudge (R32) — inline a lightweight check against `strava_tokens` if a utility does not already exist
6. Render the page:
   - Back link: `<Link href={backHref}>{backLabel}</Link>` (same pattern as `/(coach)/athletes/[id]/page.tsx`)
   - Header: sport icon (emoji), `workout.summary_stats?.name ?? getSportLabel(workout.sport)`, `formatWorkoutDateTime(workout.started_at, timezone)`, source badge
   - Primary stats row: Duration (`formatDuration`), Distance (`formatDistance`, hidden for strength), Pace/Speed (`formatPace`, omit for strength/mobility)
   - Sport-specific sections — each wrapped in a null-guard: only render the section if all data it needs is present
     - HR: `average_heartrate` present → show avg HR + max HR (if `max_heartrate` also present)
     - Elevation: `total_elevation_gain` present → show gain
     - Relative effort: `suffer_score` present → show "Relative Effort"
     - Power (bike only): `average_watts` present → show avg watts; `max_watts` → show max; `device_watts === false` → append "Estimated" label
     - PR badge: `pr_count > 0` → show "🏆 N PRs"
   - Manual nudge (R32): source === 'manual' and no strava token → render note
   - Overflow: collect `summary_stats` keys not in the per-sport allowlist; if any, render a `<details>` element with the overflow key-value list

`loading.tsx` — skeleton layout mirroring the page structure:
- Back-link placeholder block
- Header skeleton: icon-sized block + name-width block + date-width block
- Primary stats row: 3 side-by-side skeleton cards
- Body: 2–3 skeleton section blocks
- Use `className="skeleton"` (CSS pulse animation already defined in globals.css)

**Patterns to follow:**
- `apps/web/app/(athlete)/athlete/activities/loading.tsx` — skeleton block layout
- `apps/web/app/(coach)/athletes/[id]/page.tsx` — back nav via `<Link>`
- `apps/web/app/(athlete)/athlete/page.tsx` — server component auth + DB structure
- CSS custom properties: `--color-ink`, `--color-ink-muted`, `--color-border`, `--color-canvas`; `eyebrow` class for section labels
- Inline `style={{}}` objects (project convention, not Tailwind utilities)

**Test scenarios:**
- Integration: GET `/athlete/workouts/:id?from=activities` with valid Strava run → page renders name, date/time in correct timezone, duration, distance, pace, HR section (if `average_heartrate` present), elevation (if `total_elevation_gain` present)
- Integration: `?from=dashboard` → back link href is `/athlete`, label is `← Dashboard`
- Integration: `from` param absent → back link href is `/athlete/activities`
- Error path: non-existent ID → browser redirected to `/athlete/activities`
- Error path: soft-deleted workout ID → browser redirected to `/athlete/activities`
- Integration: manual workout, Strava not connected → Strava nudge shown; no HR/power sections
- Integration: Strava strength workout → distance slot absent; HR section shown if HR data present
- Loading: navigating to the route shows the skeleton before the page resolves (Next.js Suspense boundary via `loading.tsx`)

**Verification:**
- Tapping a workout from the activities list opens the detail page
- Back button from each entry point returns to the correct page
- No section renders when its data is absent
- Manual workout shows only logged fields + optional nudge
- Soft-deleted / superseded workouts redirect silently

---

- [ ] **Unit 5: Flutter GoRouter migration**

**Goal:** Wire the existing `/activities/:id` route to `ActivityDetailScreen`, replace
`Navigator.push` calls with `context.push` using the `?from=` query param, remove the
GPS map widget and its packages, and clean up dead code.

**Requirements:** R1 (Flutter), Strava ToS map removal

**Dependencies:** None (independent of web units)

**Files:**
- Modify: `daily-athlete/lib/router/router.dart`
- Modify: `daily-athlete/lib/features/activities/activity_feed.dart`
- Modify: any other file that taps into a workout to navigate to the detail screen (calendar day-view, dashboard recent-workout tap — locate during implementation)
- Modify: `daily-athlete/lib/features/activities/activities_tab.dart` (remove unused `activityId` constructor param)
- Modify: `daily-athlete/pubspec.yaml` (remove `flutter_map`, `latlong2`)

**Approach:**
- `router.dart`: change the `/activities/:id` GoRoute builder to:
  ```
  builder: (context, state) => ActivityDetailScreen(
    workoutId: state.pathParameters['id']!,
    from: state.uri.queryParameters['from'] ?? 'activities',
  )
  ```
- `activity_feed.dart`: replace `Navigator.of(context).push(MaterialPageRoute(...))` with
  `context.push('/activities/${workout.id}?from=activities')`
- Calendar and dashboard entry points: use `?from=calendar` and `?from=dashboard` respectively
- `activities_tab.dart`: remove `activityId` from constructor and the unused pass-through; the tab now navigates via GoRouter push rather than receiving an ID from the router
- `pubspec.yaml`: verify with `grep -r "flutter_map\|latlong2" daily-athlete/lib` that only `activity_detail_screen.dart` imports these, then remove both entries; run `flutter pub get`

**Patterns to follow:**
- Existing GoRoute definitions in `router.dart`
- `context.go(Routes.athleteDetail.replaceFirst(':id', id))` pattern in coach dashboard
- GoRoute `pathParameters` access pattern in existing routes

**Test scenarios:**
- Widget test: GoRouter parses `/activities/test-uuid?from=calendar` → `ActivityDetailScreen` instantiated with `workoutId='test-uuid'`, `from='calendar'`
- Widget test: `/activities/test-uuid` with no query param → `from='activities'` (default)
- Compile check: `flutter analyze` passes with no errors after `flutter_map` and `latlong2` removed
- Manual: tapping a workout in the activity feed navigates to the detail screen via GoRouter (not a floating modal)
- Manual: Android physical back button returns to the activities tab, not a blank screen

**Verification:**
- `flutter analyze` passes
- `flutter pub get` resolves without errors
- `flutter_map` and `latlong2` absent from `pubspec.yaml`
- `ActivitiesTab` has no `activityId` param

---

- [ ] **Unit 6: Flutter ActivityDetailScreen upgrade**

**Goal:** Rewrite `ActivityDetailScreen` to fetch by workout ID via a `FutureProvider`,
remove the GPS map, display sport-specific sections conditional on `summaryStats` key
presence, and handle loading / error states per spec.

**Requirements:** R1–R33 (Flutter surface), R34–R35 (Flutter), R36–R39 (Flutter)

**Dependencies:** Unit 5

**Files:**
- Modify: `daily-athlete/lib/features/activities/activity_detail_screen.dart`
- Create: `daily-athlete/lib/providers/workout_detail_provider.dart`
- Test: `daily-athlete/test/features/activities/activity_detail_screen_test.dart`

**Approach:**

Constructor: `ActivityDetailScreen({ required String workoutId, required String from })`

Provider (`workout_detail_provider.dart`):
- `FutureProvider.autoDispose.family<CompletedWorkoutRow?, String>` keyed to `workoutId`
- Calls `supabase.from('completed_workouts').select(...).eq('id', workoutId).is('deleted_at', null).is('superseded_by_id', null).maybeSingle()`
- Returns `CompletedWorkoutRow?` (null for not-found)

Screen body — follow `AthleteDashboard.dataAsync.when(...)`:
- `loading`: `Center(child: CircularProgressIndicator())`
- `error` or `data == null`: capture `ScaffoldMessenger` ref BEFORE pop, then call `showSnackBar('Could not load workout')`, then `context.pop()` (pop last — messenger ref is invalid after pop)
- `data`: render `WorkoutDetailBody`

`WorkoutDetailBody` widget:
- Header: `workout.name ?? sportLabel(workout.sport)`, `workout.startedAt.toLocal()` formatted with `DateFormat('MMM d · h:mm a')` from the `intl` package
- Source badge: 'Strava' | 'Manual Entry' chip/tag widget
- Primary stats row: Duration (`formatDurationDart`), Distance (hidden for strength; respect `unitsNotifier.swimDistance` for swim), Pace/Speed (conditional per sport matrix)
- Sport sections — each conditional on `summaryStats` key presence:
  - HR: `summaryStats['average_heartrate']` present → show avg + max HR
  - Elevation: `summaryStats['total_elevation_gain']` present → show gain
  - Relative effort: `summaryStats['suffer_score']` present → "Relative Effort"
  - Power (bike): `summaryStats['average_watts']` present → show; `device_watts == false` → "Estimated"
- Overflow: `ExpansionTile('More stats')` with key-value `ListTile`s for keys not in the per-sport allowlist
- Manual nudge (R32): `source == 'manual'` and `!hasStravaConnection` → render note; read Strava connection state from the settings provider already used by `strava_connect_section.dart`
- Back nav: `PopScope(canPop: true, onPopInvokedWithResult: (didPop, _) { if (didPop) context.go(mapFrom(from)) })` — use GoRouter `.go()` not `.pop()` for tab-aware navigation

Remove from the current file: `_ActivityMap` widget, `_decodePolyline` helper, `flutter_map` and `latlong2` imports.

**Patterns to follow:**
- `AthleteDashboard` — `dataAsync.when(loading:, error:, data:)` pattern
- `sportIcon(Sport sport)` from `activity_row.dart`
- `sportColor(Sport sport)` from `workout_chip.dart`
- `DateFormat` usage in existing calendar views
- Settings providers for Strava connection state

**Test scenarios:**
- Happy path: provider returns a Strava run with `average_heartrate: 155` → HR section renders; `total_elevation_gain: 200` → elevation section renders
- Happy path: Strava strength workout → no distance slot in primary stats row; HR section rendered if data present
- Edge case: `average_heartrate` absent from `summaryStats` → HR section not rendered
- Edge case: swim workout with `unitsNotifier.swimDistance == 'yards'` → distance converted to yards
- Error path: provider returns null (not found) → snackbar shown, screen popped
- Error path: provider throws → same snackbar + pop behavior
- Back nav: `from='dashboard'` → `context.go('/dashboard')` called on pop
- Back nav: `from='calendar'` → `context.go('/calendar')` called on pop
- Back nav: `from='activities'` → `context.go('/activities')` called on pop
- Manual workout: no HR/power/elevation sections; Strava nudge if `hasStravaConnection == false`; no nudge if connected
- Overflow: `summaryStats` has key `arbitrary_field: 42` not in allowlist → appears under "More stats"

**Verification:**
- `flutter analyze` and `flutter test` pass
- Tapping a workout in the activity feed shows the detail screen with correct sport sections
- Physical back button and the in-screen back action both return to the correct tab
- No GPS map is visible
- Loading indicator appears briefly on first load; disappears when data arrives

## System-Wide Impact

- **Interaction graph:** No callbacks or observers triggered by the read path. `buildSummaryStats` write path (Unit 1) affects all future Strava webhook events and any re-backfills — additive only.
- **Error propagation:** Web — `getWorkoutById` returns null; page calls `redirect()` and the response ends cleanly. Flutter — provider throws; error branch calls `showSnackBar` + `pop()` with a pre-captured `ScaffoldMessenger` ref.
- **State lifecycle risks:** GoRouter `?from=` URI param survives process kill and cold-link restores. The overflow `<details>` (web) and `ExpansionTile` (Flutter) are local UI state — no persistence needed.
- **API surface parity:** All three entry points (dashboard, activities, calendar) on both platforms must emit `?from=`. If any is missed, back navigation silently falls back to Activities — acceptable but worth verifying in QA.
- **Integration coverage:** RLS policy `completed_workouts_self_select` prevents athletes from fetching each other's workouts. The explicit `athlete_id` filter in `getWorkoutById` is defense-in-depth. `supabase-dart` also reads via RLS.
- **Unchanged invariants:** `getRecentWorkouts`, `getWorkoutsInRange`, `WorkoutRow` type are not modified. The `ActivityDetailScreen` constructor signature changes (Unit 5 must be merged before Unit 6 can compile).

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `users.timezone` absent from `getUserWithRoles()` return type | Verify during Unit 2; add to the type and underlying query if missing |
| Strava data surface fields absent → key sections permanently empty at launch | Documented explicitly; sections appear automatically once the data surface expansion plan ships |
| `flutter_map` / `latlong2` imported by files other than `activity_detail_screen.dart` | Run `grep -r "flutter_map\|latlong2" daily-athlete/lib` before removing from `pubspec.yaml` |
| Calendar and dashboard Flutter tap handlers not yet linked to workout detail | Unit 5 must locate and update all entry points — search for `ActivityDetailScreen` instantiation sites |
| `buildSummaryStats` name change (Unit 1) only affects future events; historical rows have no name | Documented — names appear for new activities immediately; re-backfill is optional/separate |
| `PopScope` + GoRouter `.go()` double-fires on Android back gesture | Test on a physical Android device; use `didPop` guard in `onPopInvokedWithResult` |
| Manual workout coach notes (R31) not implemented | Explicitly deferred; page renders correctly without it |

## Documentation / Operational Notes

- No DB migrations required — this plan is purely read-side.
- Unit 1's `name` write to `summary_stats` is additive. Historical activities will lack a name until re-backfilled — acceptable for v1.
- Unit 5 removes `flutter_map` and `latlong2` from `pubspec.yaml`. The lockfile (`pubspec.lock`) will change and must be committed alongside the `pubspec.yaml` change.
- After merging, verify that `activity_feed.dart` uses `context.push` (not `Navigator.push`) by grepping for `Navigator.of(context).push` in the activities feature directory.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-17-workout-detail-page-requirements.md](docs/brainstorms/2026-05-17-workout-detail-page-requirements.md)
- Related plan: [docs/plans/2026-05-17-001-feat-flutter-core-navigation-plan.md](docs/plans/2026-05-17-001-feat-flutter-core-navigation-plan.md)
- Related brainstorm: [docs/brainstorms/2026-05-17-strava-data-surface-requirements.md](docs/brainstorms/2026-05-17-strava-data-surface-requirements.md)
- `apps/web/src/db/workouts.ts` — DB layer pattern to follow
- `daily-athlete/lib/router/router.dart` — GoRouter config to modify
- `daily-athlete/lib/features/activities/activity_detail_screen.dart` — current screen to replace
- `daily-athlete/lib/features/athlete_dashboard/athlete_dashboard.dart` — loading/error pattern
