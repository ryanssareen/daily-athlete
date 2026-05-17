---
date: 2026-05-17
topic: workout-detail-page
---

# Workout Detail Page

## Problem Frame

Athletes and coaches need to see the full breakdown of a completed workout — not just
the summary chip on a calendar or activity row. The detail page is reached by tapping
any workout card from three different contexts (dashboard, activities, calendar) and must
display sport-specific stats appropriately for both Strava-synced and manually logged
workouts. The page exists on both web (Next.js) and Flutter.

---

## Back Navigation

Each entry point passes its origin so the back button returns to the right place.

| Entry point | Web query param | Flutter route extra | Back label |
|---|---|---|---|
| Dashboard | `?from=dashboard` | `from: "dashboard"` | ← Dashboard |
| Activities | `?from=activities` | `from: "activities"` | ← Activities |
| Calendar | `?from=calendar` | `from: "calendar"` | ← Calendar |

If `from` is absent or unrecognized, fall back to Activities.

---

## Page Structure

```
[ ← Back label ]

[ Sport icon ]  [ Workout name / sport label ]
[ Date · Time of day ]

[ Source badge: "Strava" | "Manual" ]

┌─ Primary Stats ──────────────────────────────┐
│  Duration      Distance       Pace / Speed   │
│  (always)      (if applicable) (if applicable)│
└──────────────────────────────────────────────┘

[ Sport-specific stat sections — see below ]

[ Effort / Load section — if data present ]

[ PR / Achievements — if pr_count > 0 ]
```

---

## Requirements

**Navigation**

- R1. The detail page accepts a `from` parameter on both platforms. The back button label
  and destination match the entry point per the table above.
- R2. If reached directly (no `from`), back returns to Activities.

**Header**

- R3. Display the workout name if available (Strava `name` field; manual workouts may
  have no name — show sport label as fallback, e.g. "Run").
- R4. Display sport icon and formatted date + time of day in the athlete's local timezone
  (e.g. "May 12 · 7:14 AM"). Never display UTC time to the user.
- R5. Show a source badge: "Strava" (with Strava logo/color) or "Manual Entry".

**Primary Stats Row**

- R6. Always show Duration (formatted as h:mm:ss or m:ss depending on length).
- R7. Show Distance for all sports except strength. If the workout has no distance value,
  show "—". For strength, omit the distance slot entirely (consistent with R22).
- R8. Derive and show Pace (run/swim: per km or per 100m) or Speed (bike: km/h) alongside
  distance. For strength and mobility, omit the pace/speed slot.

**Strava Workouts — Run**

- R9. Show average HR and max HR if `average_heartrate` is present.
- R10. Show Elevation gain if `total_elevation_gain` is present.
- R11. Show Relative Effort (suffer_score) if present, labeled "Relative Effort".
- R12. If `pr_count > 0`, show a PR badge ("🏆 N PRs") in the header area.

**Strava Workouts — Bike**

- R13. Same as Run (R9–R12).
- R14. Show average power and max power if `average_watts` or `max_watts` is present.
- R15. Show "Estimated power" label if `device_watts = false`; omit the label if
  `device_watts = true` (real power meter).
- R16. Show Indoor badge if `trainer = true`.

**Strava Workouts — Swim**

- R17. Show distance in meters (not km).
- R18. Show stroke type if available from sport_type or summary_stats
  (e.g. "Freestyle", "Open Water"). If not available, omit — do not show "Unknown".
- R19. Show average HR and max HR if present.
- R20. Show stroke rate (average_cadence for swim = strokes/min) if present,
  labeled "Stroke Rate".
- R21. Show any other swim-specific fields present in summary_stats (e.g. pool length,
  total strokes) with human-readable labels. Unknown keys are displayed as-is
  (camelCase → "Camel Case").

**Strava Workouts — Strength**

- R22. Omit distance, pace, and elevation sections entirely — the distance slot from the
  primary stats row is also hidden (not shown as "N/A").
- R23. Show duration only.
- R24. Show HR if present (some lifters wear HR monitors).
- R25. Show Relative Effort (suffer_score) if present.

**Strava Workouts — Other Sports (mobility, other)**

- R26. Show duration and distance (if any).
- R27. Show HR and elevation if present.
- R28. Any additional summary_stats fields displayed in a generic key-value list.

**Manual Workouts**

- R29. Show whatever fields were logged: duration and/or distance if present.
- R30. Do not show any Strava-specific sections (HR, power, elevation, RPE, PR).
- R31. If the workout has coaching notes or rationale from a matched planned workout,
  show them in a "Coach notes" section.
- R32. Display a note: "Logged manually — connect Strava for detailed stats." Only show this note if the athlete does not already have a Strava integration connected.

**Loading and Error States**

- R34. While the workout data is fetching, show a centered loading spinner.
- R35. If the fetch fails, navigate back to the originating page and show a brief
  error toast ("Could not load workout").

**Generic Stats Overflow**

- R33. Any summary_stats keys not handled by a named section above are shown in a
  collapsed "More stats" section (expanded by tap). This future-proofs the page for
  new Strava fields without requiring a code change.

**Timezone Handling**

- R36. All `started_at` values are stored in UTC. This is the single storage rule for
  both workout types.
- R37. For Strava workouts: use `start_date` (UTC) directly from the Strava API response.
  Do not adjust or re-interpret it.
- R38. For manual workouts: capture the athlete's local timezone at creation time, convert
  the entered local time to UTC, and store the UTC value in `started_at`.
- R39. On display (detail page, calendar, activity feed): always convert `started_at` from
  UTC to the athlete's current device/browser timezone before rendering. Never show raw UTC.

---

## Success Criteria

- Tapping a workout from calendar, dashboard, or activities opens the detail page and
  the back button returns to the correct originating page.
- Strava run shows: name, date, duration, distance, pace, HR, elevation, relative effort,
  and PR badge if applicable.
- Strava swim shows: name, date, duration, distance (meters), stroke type if available,
  HR if available, stroke rate if available.
- Strava bike shows: name, date, duration, distance, speed, HR, power (with estimated
  label if no power meter), elevation, indoor badge if trainer.
- Strength shows: name, date, duration only. Distance and pace slots are hidden.
- Manual workout shows duration/distance only, with a "connect Strava" nudge.
- No section renders with a blank value — if data is absent, the section is hidden.

---

## Scope Boundaries

- No editing from this page — detail is read-only (editing is a separate feature).
- No map/route display — GPS coordinates are excluded (Strava ToS).
- No lap splits in v1 — lap data is deferred per the Strava data surface requirements.
- No social actions (kudos, comments) — stored but not surfaced.
- No share / export in v1.
- No planned workout overlay in v1 (showing the plan alongside the completion is future).

---

## Key Decisions

- **`from` param drives back nav:** Web uses query param (`?from=dashboard`). Flutter uses
  GoRouter `extra` map — requires migrating `ActivityDetailScreen` to GoRouter as part of
  this feature.
- **Sections hidden when data absent:** Never show a section with "—" in every field.
  If HR is unavailable, the HR section doesn't render at all. Applies to strength distance
  slot too — omitted entirely rather than showing "N/A".
- **Spinner + navigate back on error:** While loading, show a spinner. If fetch fails,
  pop back to the originating page with an error toast. No separate error screen needed.
- **Generic overflow section:** The `summary_stats` JSONB can grow (new Strava fields,
  expanded schema from the data surface requirements). A "More stats" overflow section
  means new fields appear without a release.
- **Same page URL/route for both workout types:** `source` on the CompletedWorkout
  record determines the layout variant; there is no separate route per type.

---

## Dependencies / Assumptions

- Depends on `apps/web/src/strava/schemas.ts` expansion (Strava data surface requirements)
  for fields like `has_heartrate`, `device_watts`, `trainer`, `pr_count`, `max_watts`.
  Until that expansion ships, those fields will be absent and their sections hidden.
- Flutter `CompletedWorkoutRow` model already exposes `summaryStats`, `distanceM`,
  `durationS`, `sport`, `source` — sufficient for v1.
- Web route `app/(athlete)/athlete/workouts/[id]/page.tsx` already exists as a stub.
- Flutter route `/activities/:id` already exists (ActivityDetailScreen) — this replaces
  or upgrades that screen. The existing screen must be migrated from `Navigator.push` to
  GoRouter, and its GPS map widget removed (Strava ToS + scope boundary).
- R31 (coach notes) requires a JOIN on `workout_matches` to load the matched planned
  workout and its coaching rationale. This join is not currently performed by any
  workout-fetching query.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R18][Technical] Strava's swim `sport_type` values include "Swim" but not stroke
  type. Does Strava expose stroke type in any field we have access to, or is R18 only
  achievable with the expanded schema? Verify against Strava API docs.
- [Affects R1][Technical] Flutter GoRouter: does `extra` survive deep-link restores, or
  does the back target need to be encoded in the route path instead?
- [Affects R31][Technical] How are matched planned workouts loaded on the detail page —
  via a join on `workout_matches`, or passed as part of the navigation payload?
- [Affects R33][Design] What is the human-readable label strategy for arbitrary
  summary_stats keys — camelCase split, snake_case split, or a static display-name map?
- [Affects Scope][Technical] The existing `ActivityDetailScreen` contains a `flutter_map`
  GPS route widget. This must be removed — it violates the "No map/route display" scope
  boundary and Strava ToS. Confirm removal is in scope for this feature.
- [Affects R3][Technical] The `name` field is not yet stored in `completed_workouts` — it
  requires the schema expansion from the Strava data surface requirements (R2 of that doc).
  Until it ships, R3 falls back to sport label for all workouts including Strava.

---

## Next Steps

→ `/ce:plan` for structured implementation planning
