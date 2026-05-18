---
date: 2026-05-18
title: "feat: Strava workout enrichment (power, zones, laps)"
status: active
origin: docs/brainstorms/2026-05-18-strava-workout-enrichment-requirements.md
---

# feat: Strava workout enrichment (power, zones, laps)

## Problem Frame

The redesigned workout-detail page (commit `895cf88`) renders the editorial
shell, but the design's Zone Distribution and Lap Splits sections are
absent because the data is not on disk, and the hero's secondary grid is
sparse because we extract only ~9 of the ~30 product-valuable fields
Strava returns from `GET /activities/{id}`.

Strava exposes all of this richer aggregate data via endpoints we are not
calling (`/activities/{id}/laps`, `/activities/{id}/zones`,
`/athlete/zones`) and via fields we do not extract from the detail
endpoint we *are* calling (`weighted_average_watts`, `kilojoules`,
`max_watts`, `calories`, etc.). None of this is stream-level — the
project's Strava ToS posture (migration `0008`) remains intact.

(see origin: `docs/brainstorms/2026-05-18-strava-workout-enrichment-requirements.md`)

## Requirements Trace

| Req | Unit | Description |
|-----|------|-------------|
| R1, R2 | 1 | Extend `StravaActivitySchema` + `buildStats` helpers |
| R5, R7, R9 | 2 | Add `/laps`, `/zones`, `/athlete/zones` to the Strava client |
| R10, R12 | 3 | Sync route calls new endpoints + caches `/athlete/zones` |
| R11 | 4 | Lazy auto-hydration on first workout-detail view |
| R3, R4 | 5 | Surface new metrics + IF/TSS in Hero |
| R6, R8 | 6 | Render Zone Distribution + Lap Splits sections |

## High-Level Technical Design

> *Directional. The implementing agent should treat this as context, not code to reproduce.*

```
User opens /athlete/workouts/[id]
  └─ page.tsx (server component)
       ├─ getWorkoutById()                              ← existing
       ├─ shouldHydrate(workout) === true?              ← Unit 4: missing laps/zones?
       │     └─ POST internal hydrate fn (5s cap)       ← Unit 4
       │           └─ hydrateStravaWorkout(workoutId)   ← Unit 3
       │                 ├─ GET /activities/{id}        ← Unit 1 schema
       │                 ├─ GET /activities/{id}/laps   ← Unit 2 client
       │                 ├─ GET /activities/{id}/zones  ← Unit 2 client
       │                 └─ GET /athlete/zones (if stale)
       │                       └─ cache to athlete_profiles.manual_fields.strava_zones
       │                 └─ UPDATE completed_workouts.summary_stats
       └─ render Hero (Unit 5) + MapCard + Laps (Unit 6) + Zones (Unit 6)

Sync button (existing) → /api/integrations/strava/sync-workout (Unit 3)
  └─ same hydrateStravaWorkout(workoutId) ← single source of truth

Backfill (unchanged)
  └─ continues to extract ONLY detail fields; no /laps or /zones calls
```

**Storage shape** — Everything new lands in the existing
`summary_stats` JSONB. No migration. Schema:

```ts
// summary_stats:
{
  // ── existing ──
  name?: string;
  average_speed?: number; max_speed?: number;
  average_heartrate?: number; max_heartrate?: number;
  average_watts?: number;
  total_elevation_gain?: number;
  suffer_score?: number;
  average_cadence?: number;
  polyline?: string;

  // ── Unit 1: new detail fields ──
  description?: string;
  calories?: number;
  weighted_average_watts?: number;     // = Normalized Power
  kilojoules?: number;
  max_watts?: number;
  elev_high?: number; elev_low?: number;
  average_temp?: number;
  device_watts?: boolean;              // false = estimated power
  has_heartrate?: boolean;
  trainer?: boolean; commute?: boolean; manual?: boolean;
  pr_count?: number; achievement_count?: number;
  start_date_local?: string;
  utc_offset?: number;

  // ── Unit 3: new endpoint payloads ──
  laps?: Array<{
    lap_index: number;
    elapsed_time: number; moving_time: number;
    distance: number;
    average_speed?: number; max_speed?: number;
    average_heartrate?: number; max_heartrate?: number;
    average_cadence?: number; average_watts?: number;
    total_elevation_gain?: number;
  }>;
  zones?: Array<{
    type: "heartrate" | "power";
    distribution_buckets: Array<{ min: number; max: number; time: number }>;
    sensor_based?: boolean;
    custom_zones?: boolean;
  }>;
  hydrated_at?: string;                // ISO; lazy-hydration timestamp
}
```

**Athlete-zones cache shape** — On `athlete_profiles.manual_fields`:

```ts
{
  // ── existing keys preserved ──

  // ── Unit 3 ──
  strava_zones?: {
    fetched_at: string;                  // ISO; refresh if > 7 days old
    heart_rate?: {
      custom_zones?: boolean;
      zones: Array<{ min: number; max: number }>;
    };
    power?: {
      zones: Array<{ min: number; max: number }>;
    };
  };
}
```

Reading from `manual_fields` is intentional — it is the existing pattern
for per-athlete JSONB. The lockstep trigger only stamps top-level keys
the user wrote; planning must verify a write to `strava_zones` from
server-role does not trip the user-edit semantics.

## Implementation Units

---

### Unit 1 — Extend `StravaActivitySchema` and `buildStats` helpers

- [ ] **Goal**: Capture every product-valuable non-stream field from
  `GET /activities/{id}` without changing any endpoint surface or DB
  shape. Pure extraction expansion.

**Files**:
- `apps/web/src/strava/schemas.ts` — add new optional fields to
  `StravaActivitySchema`
- `apps/web/src/strava/backfill-helpers.ts` — extend `buildSummaryStats`
- `apps/web/app/api/integrations/strava/sync-workout/route.ts` —
  extend `buildStats` to match (or, better, deduplicate against the
  helper above)

**Approach**:
1. Add the fields enumerated under R1 to `StravaActivitySchema` as
   `optional()` / `nullable()` with matching Zod types. Match the
   existing pattern (`.number().nonnegative().optional()` for stats,
   `.boolean().optional()` for flags).
2. Extract a single `buildSummaryStats(activity)` helper to
   `apps/web/src/strava/build-summary-stats.ts` (new file). Both the
   backfill helper and the sync route import from it. Eliminates the
   current duplication between `backfill-helpers.ts`'s
   `buildSummaryStats` and `sync-workout/route.ts`'s `buildStats`.
3. Update both call sites to import the shared helper.

**Patterns to follow**:
- Existing optional-field idiom in `apps/web/src/strava/schemas.ts`
  (e.g. `z.number().nonnegative().optional()`)
- Existing conditional-add pattern in `buildSummaryStats` (`if (x != null) stats.x = x`)

**Test file**: `apps/web/src/strava/__tests__/build-summary-stats.test.ts` (new)

**Test scenarios**:
- Returns all known fields when a fully-populated Strava activity is passed
- Omits keys for absent fields (does NOT serialise as `undefined` or `null`)
- `name` is preserved as a separate path even when summary_stats grows
- `device_watts: false` round-trips correctly (not stripped as falsy)
- Schema rejects an activity with a negative `kilojoules` (validates the
  `.nonnegative()` constraint)

**Verification**: Open the redesigned hero on a real bike workout
after deploying Unit 1 only — the existing renderer should already
pick up `weighted_average_watts` and `max_watts` because the
secondary-grid renderer reads from `summary_stats` by key. (Unit 5
adds the actual labelling.)

---

### Unit 2 — Add `/laps`, `/zones`, `/athlete/zones` Zod schemas + client methods

- [ ] **Goal**: Make the three new endpoints typesafely fetchable
  without touching any caller. Pure additive infrastructure.

**Files**:
- `apps/web/src/strava/schemas.ts` — add `StravaLapSchema`,
  `StravaZoneSchema`, `StravaAthleteZonesSchema`
- `apps/web/src/strava/client.ts` — **no changes** (the existing
  `fetch(path)` method already supports arbitrary paths)
- `apps/web/src/strava/endpoints.ts` (new) — three thin typed wrappers:
  `fetchActivityLaps(client, id)`, `fetchActivityZones(client, id)`,
  `fetchAthleteZones(client)`. Each does: client.fetch → status check →
  json → zod parse → return.

**Approach**:
1. Define Zod schemas matching Strava's documented response shapes.
   For zones, the response is `Array<{ type, distribution_buckets,
   sensor_based?, custom_zones? }>` per the API docs. For laps it's
   `Array<Lap>`. For athlete/zones it's
   `{ heart_rate?: { custom_zones, zones }, power?: { zones } }`.
2. Each typed wrapper returns `null` when Strava returns 404 (athlete
   has no zones configured / activity has no laps). 5xx and other
   errors bubble.
3. Reuse the existing `StravaReauthRequired` / `StravaRateLimited`
   error semantics — the typed wrappers don't add new error classes.

**Patterns to follow**:
- `StravaActivitySchema` for Zod style
- `apps/web/src/strava/run-backfill.ts` for `client.fetch(path)` → res check → json → parse pattern

**Test file**: `apps/web/src/strava/__tests__/endpoints.test.ts` (new)

**Test scenarios**:
- `fetchActivityLaps` parses a real-looking response (use a captured
  fixture if available, else hand-rolled minimal shape)
- `fetchActivityLaps` returns `null` on 404
- `fetchActivityZones` returns `[]` when athlete has no zones
  configured (Strava returns `[]`, not 404, for this case — verify
  during research)
- `fetchAthleteZones` returns `null` when athlete has no zones
- All three throw `StravaRateLimited` on 429 (via the existing client
  behaviour — pass a mocked client that throws this)

**Verification**: Tests pass; no callers exist yet so behaviour is
proven by tests only.

---

### Unit 3 — `hydrateStravaWorkout` service + sync-route extension

- [ ] **Goal**: Single function that fetches detail + laps + zones +
  (if stale) athlete zones, then writes everything to the right DB
  rows in one transaction. Reused by both the manual sync route and
  the auto-hydration trigger (Unit 4).

**Files**:
- `apps/web/src/strava/hydrate-workout.ts` (new) — exports
  `hydrateStravaWorkout({ admin, userId, workoutId }): Promise<HydrateResult>`
- `apps/web/app/api/integrations/strava/sync-workout/route.ts` —
  reduces to a thin wrapper around the new service
- `apps/web/src/db/athlete-profiles.ts` (new or existing) — add
  `getStravaZonesCache(admin, userId)` and
  `updateStravaZonesCache(admin, userId, zones)` helpers; both filter
  by user_id and carry the `// service-role: explicit user filter
  required` comment

**Approach**:
1. The service flow:
   ```
   loadWorkout(workoutId)
   parallel:
     fetchDetail(strava_activity_id)
     fetchLaps(strava_activity_id)        // null-tolerant
     fetchZones(strava_activity_id)       // [] tolerant
   maybeRefreshAthleteZones(userId)       // 7-day TTL on manual_fields.strava_zones.fetched_at
   buildSummaryStats(detail) + { laps, zones, hydrated_at: now }
   UPDATE completed_workouts SET summary_stats = $1 WHERE id = $2 AND athlete_id = $3
   ```
2. Three Strava calls in `Promise.all` to amortise wall-clock latency.
   With one client instance, this serialises through the token-load
   mutex but each request still uses a single bearer.
3. Athlete-zones refresh: read the cached
   `manual_fields.strava_zones.fetched_at`; if absent or > 7 days,
   fetch and write back. A single UPDATE with a JSONB merge:
   `manual_fields = manual_fields || jsonb_build_object('strava_zones', $1)`.
   Verify this does NOT trip the lockstep trigger — if it does, use the
   service-role bypass path that already exists for the `backfill_status`
   column in migration `0009`.
4. The sync route becomes:
   ```ts
   try { await hydrateStravaWorkout({ admin, userId, workoutId }); }
   catch (StravaReauthRequired) → 401
   catch (StravaRateLimited)    → 429
   return 200
   ```

**Patterns to follow**:
- `apps/web/app/api/integrations/strava/sync-workout/route.ts` for
  error-to-HTTP-status mapping
- `apps/web/src/strava/backfill-helpers.ts`'s `processActivityPage`
  for the "fetch + transform + persist" sequence
- `apps/web/src/db/backfill-status.ts` for the explicit-user-filter
  service-role pattern

**Test file**: `apps/web/src/strava/__tests__/hydrate-workout.test.ts` (new)

**Test scenarios**:
- Happy path: detail + laps + zones all 200; row gets updated with
  the merged `summary_stats`; athlete-zones cache populated
- Athlete-zones cache is < 7 days old: `/athlete/zones` is NOT called
- Laps returns null (404): row updates without `laps` key, no error
- Zones returns []: row updates with `zones: []`, no error
- Strava 401 + refresh fails: `StravaReauthRequired` propagates
- Strava 429 on any call: `StravaRateLimited` propagates
- Two concurrent calls for the same workout: idempotent — the second
  write does not corrupt the first (verify with an explicit ordering
  test using a controlled mock)

**Verification**:
- Manual: click "Sync from Strava" on a real bike workout; verify
  Network tab shows ONE outbound POST; verify DB row has new
  `summary_stats.laps` and `summary_stats.zones`.
- Confirm athlete-zones cache row is written exactly once across
  multiple sync clicks within 7 days.

---

### Unit 4 — Lazy auto-hydration on first detail-page view

- [ ] **Goal**: When a user opens a workout-detail page and the row
  has not been hydrated yet, fetch laps + zones inline (5-second cap)
  so the first paint already shows the new sections.

**Files**:
- `apps/web/app/(athlete)/athlete/workouts/[id]/page.tsx` — add an
  inline `await` to `hydrateStravaWorkout` when stale; React
  `Suspense` boundary so the rest of the page can render fast
- `apps/web/app/(athlete)/athlete/workouts/[id]/MaybeHydrate.tsx`
  (new) — a server component child that awaits the hydration and
  returns nothing visible; renders inside a `<Suspense>` with the
  zone/lap sections as the fallback's siblings

**Approach**:
1. Define `shouldHydrate(workout)`:
   ```ts
   const isStrava = workout.source === "strava";
   const hasId   = workout.strava_activity_id != null;
   const isGPS   = ["bike", "run", "swim"].includes(workout.sport.toLowerCase());
   const stale   = workout.summary_stats.hydrated_at == null;
   return isStrava && hasId && isGPS && stale;
   ```
2. If `shouldHydrate` is true, fire `hydrateStravaWorkout` from a
   server component with `Promise.race` against a 5-second
   `setTimeout`. On timeout or any error, render the page without
   waiting — the row stays unhydrated; user can click Sync to retry.
3. After hydration completes (within the window), re-read the workout
   row so the renderer picks up the new `summary_stats`. To avoid a
   second roundtrip, `hydrateStravaWorkout` returns the new
   `summary_stats` directly; the page merges it onto the in-memory
   workout object.
4. Concurrency: two parallel tabs hitting the same workout — both
   trigger hydration, both call Strava. Acceptable: the second
   UPDATE overwrites the first with the same data. No locking needed.
   (Documented in the brainstorm's outstanding question; the chosen
   resolution is "accept double-fetch.")

**Patterns to follow**:
- `apps/web/app/(athlete)/athlete/workouts/[id]/page.tsx` async server
  component pattern
- No existing precedent in the repo for `Promise.race` + timeout in a
  server component — flag this in code review as a new pattern.

**Test file**: `apps/web/app/(athlete)/athlete/workouts/[id]/__tests__/page.test.ts` (new, integration-style with a mocked Strava client)

**Test scenarios**:
- Stale Strava bike workout: page render triggers hydration; rendered
  HTML includes the Zone Distribution section
- Fresh workout (`hydrated_at` recent): hydration is NOT triggered
- Manual workout: hydration is NOT triggered
- Strava times out (>5s): page still renders within budget; row stays
  unhydrated
- Strava 401: page renders; row stays unhydrated; no exception
  escapes to the request handler

**Verification**:
- Open a previously-unhydrated bike workout: laps + zones appear on
  first paint.
- Open it again: no Strava call (verify with Network tab on the
  server logs / no new entry in the `strava_raw_payloads` table).

---

### Unit 5 — Hero update: Normalized Power, Energy, Max Power, IF/TSS, Calories

- [ ] **Goal**: Show the new aggregate fields in the hero's secondary
  grid, plus the computed IF/TSS pair when FTP is known.

**Files**:
- `apps/web/app/(athlete)/athlete/workouts/[id]/Hero.tsx` — extend
  `buildSecondaryStats` to surface NP, Energy (kJ), Max Power,
  Calories, IF, TSS
- `apps/web/src/lib/training-math.ts` (new) — pure functions
  `computeIF(np, ftp)` and `computeTSS(durationSec, np, ftp)` plus
  unit tests

**Approach**:
1. Add stat entries gated on each field's presence in the order:
   - Avg/Max HR (existing)
   - **Normalized Power** (`weighted_average_watts`, "W")
   - **TSS** (computed when NP + FTP exist; sub: `IF ${if.toFixed(2)}`)
   - **Energy** (`kilojoules`, "kJ")
   - **Max Power** (`max_watts`, "W")
   - **Calories** (`calories`)
   - Cadence (existing)
   - Max Speed (existing)
   - Suffer Score (existing)
2. The Hero component receives an additional optional
   `athleteZones?: AthleteZonesCache` prop (provided by `page.tsx`
   from `manual_fields.strava_zones`). FTP = first zone's `max` from
   the power array (Strava's Z1 ends at 0.55×FTP, but the actual FTP
   is encoded as the lower bound of the last open-ended zone — verify
   exact field during implementation).
3. When `device_watts === false`, annotate the Avg Power and
   Normalized Power values with a small "est." pill next to the
   number (font: mono, color: ink-subtle, italic). Add this style to
   `globals.css` under `.wd-estimated-pill`.

**Patterns to follow**:
- Existing `buildSecondaryStats` factory pattern in `Hero.tsx`
- `wd-sec-stat-*` CSS classes in `globals.css`

**Test file**: `apps/web/src/lib/__tests__/training-math.test.ts` (new)

**Test scenarios**:
- `computeIF(265, 265) === 1.0`
- `computeIF(300, 265) ≈ 1.13`
- `computeTSS(3600, 265, 265) === 100`  (canonical 1-hour FTP test)
- `computeTSS(0, 200, 265) === 0` (degenerate)
- `computeIF(np, 0)` returns `null` (avoid divide-by-zero)
- Snapshot of `buildSecondaryStats` for a bike workout with all power
  fields populated

**Verification**: Visual diff of the hero secondary grid before vs.
after hydration on a real bike workout. The new pills appear in the
right order; no broken layout when the grid grows past 6 columns
(responsive collapse to 3-col at <1100px already handles this).

---

### Unit 6 — `ZoneDistribution` and `LapSplits` sections

- [ ] **Goal**: Render the design's `ZoneDistribution` and `LapSplits`
  components, fed by `summary_stats.zones` and `summary_stats.laps`.

**Files**:
- `apps/web/app/(athlete)/athlete/workouts/[id]/ZoneDistribution.tsx` (new)
- `apps/web/app/(athlete)/athlete/workouts/[id]/LapSplits.tsx` (new, client component for expand-on-click)
- `apps/web/app/globals.css` — port `.wd-zones-*` and `.wd-laps-*` style
  blocks from the design's `styles.css` (matching the `.wd-*`
  namespace from commit `895cf88`)
- `apps/web/app/(athlete)/athlete/workouts/[id]/page.tsx` — render the
  two new sections conditionally on data presence

**Approach**:
1. `ZoneDistribution` (server component):
   - Receives `zones: Array<{ type, distribution_buckets }>` from
     `summary_stats.zones`
   - Renders two cards (power, hr) side-by-side using the design's
     2-column zone grid; if only one type present, full-width
   - Each card: title + stacked bar (rendered as a flex row of
     coloured cells, widths from bucket time / total time) + legend
     table (Z1–Z5/Z6 name, label, time, %)
   - Color palette taken from the design's `POWER_ZONES` /
     `HR_ZONES` constants in `workout-details/utils.js` — port them
     to a TS constants file `apps/web/src/lib/zone-palette.ts`
2. `LapSplits` (client component, `useState` for expanded row):
   - Receives `laps: Array<Lap>` from `summary_stats.laps`
   - Renders the design's `.laps-table` layout: header row +
     per-lap row (lap #, label, duration, avg power, avg HR, target?)
   - Click on a row expands an inline 4-up grid (Distance, Pace,
     Cadence, Avg Speed)
   - Lap "kind" detection: heuristic from `average_watts` vs
     overall median — high-power laps marked as "work," low-power
     as "recover," first/last as "warm-up"/"cool-down." This is a
     UI nicety; if it's noisy in real data, drop the colored
     `lap-kind` strip and render uniform rows.
3. Page integration:
   ```tsx
   {zonesPresent && <ZoneDistribution zones={stats.zones} hrMax={...} ftp={...} />}
   {lapsPresent  && <LapSplits laps={stats.laps} sport={sport} />}
   ```
   Both go between the `MapCard` and the existing overflow stats.

**Patterns to follow**:
- `Hero.tsx` for the server-component + className pattern
- The design's `Chart.jsx` (ZoneBar function) and
  `Footer.jsx` (LapSplits function) for component shape
- The `.wd-*` CSS namespace established in commit `895cf88`

**Test files**:
- `apps/web/src/lib/__tests__/zone-palette.test.ts` (palette stability)
- Visual verification only for the components themselves (snapshot
  tests on JSX server components add little value here)

**Test scenarios**:
- Zone palette has exactly 6 power + 5 HR entries with valid hex
  colors
- `ZoneDistribution` renders only the power card when `zones`
  contains only `type: "power"` (manual JSX check)
- `LapSplits` renders N rows for N laps

**Verification**:
- Real bike workout: both sections render with sensible colours and
  the stacked bar widths sum to 100%
- Real run workout (no power): only the HR zone card renders, full
  width

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Strava rate-limit cap of 1000/day hits during a viral usage spike | Med | Lazy-on-view caps the worst case at 3 calls per unique workout view; if it becomes a problem, add a 24-hour TTL on hydration retries so failed lookups don't keep burning credits |
| `manual_fields` lockstep trigger fires on automated `strava_zones` write | Med | Verify behaviour against migration `0005` during Unit 3; if it trips, use the `backfill_status` service-role bypass path established in migration `0009` |
| 5-second auto-hydration cap makes some workouts feel slow on first paint | Low | The remainder of the page is fast (cached row read); only the zones/laps sections wait. Acceptable for an opt-in "first view" |
| Strava `/zones` response shape differs from Zod schema (athlete edge case) | Med | Capture the raw response into `strava_raw_payloads` for any parse failure so we can iterate |
| `device_watts === false` annotation crowds the hero on narrow viewports | Low | The "est." pill is < 30px wide; if it overflows, drop to an explicit footnote row |

## Rollout

1. Land Units 1–2 first (pure additive, no behaviour change). Ship.
2. Land Unit 3 (sync route now does more work but is still gated on
   user click). Ship and watch Strava rate-limit headers in the logs
   for 24 hours.
3. Land Units 4–6 together (first-view hydration plus the UI that
   needs the new data). Ship.
4. No flag; the feature is gated by data presence (workouts without
   the new fields just render the existing hero unchanged).

## Deferred to Implementation

- Exact extraction of FTP from `/athlete/zones` — Strava's response
  shape has multiple plausible reads. Resolve during Unit 3 by
  fetching against a test account.
- Whether `ZoneDistribution` and `LapSplits` should be folded into a
  shared "Performance" section header — defer to visual review during
  Unit 6.
- Whether to write to `strava_raw_payloads` on parse failure
  (resilience vs. PII concern) — defer to Unit 2.

## Done When

- [ ] All 6 unit checkboxes ticked.
- [ ] `pnpm typecheck` and `pnpm lint` clean.
- [ ] `pnpm build` succeeds.
- [ ] Non-DB Vitest suite passes (155+ tests).
- [ ] A bike workout with power data renders the full design: hero
  with NP/TSS/Energy/Max Power, zone distribution with power + HR
  cards, lap splits table with expandable rows.
- [ ] A run workout renders with HR zones only (no power card) and
  pace-based laps.
- [ ] A strength workout renders the existing hero with no zones or
  laps section (graceful absence).
- [ ] `docs/solutions/strava-workout-enrichment.md` captures the
  hydration-on-view pattern and the athlete-zones cache pattern for
  future reuse.
