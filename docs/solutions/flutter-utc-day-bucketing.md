---
title: Flutter Bucketed Workouts by the UTC Day (recurring IST-shown-as-UTC bug)
date: 2026-10-19
status: active
category: solutions
module: daily-athlete Flutter calendar and dashboard
problem_type: logic_error
component: frontend
symptoms:
  - "An IST workout started between 00:00 and 05:29 showed on the previous day in the Calendar and the year heatmap"
  - "Home 'this week' put an early-Monday IST workout into the previous week"
  - "The same bug kept coming back after earlier timezone fixes shipped"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [timezone, utc, local-day, flutter, dart, calendar, strava, recurring-bug, ist]
related_components: [athlete_timezone, strava_sync, ci]
---

# Flutter Bucketed Workouts by the UTC Day

The fourth fix for "IST shows as UTC", and the first one that touched the
Flutter app. Fixed in PR #120 (pending merge when this was written).
Production data was never wrong: the app grouped correct instants by the wrong
calendar.

## Problem

`started_at` reaches Flutter as a UTC instant (`2026-10-18 23:30:00+00`).
`DateTime.parse` of a string with an offset returns a UTC `DateTime`
(`isUtc == true`), so `.year`, `.month` and `.day` are the **UTC** fields.
`calendar_providers.dart` keyed each workout with
`DateTime.utc(dt.year, dt.month, dt.day)`, and `dashboard_providers.dart` built
its week from `date.toUtc()`. A 05:00 IST Monday run (`23:30Z` Sunday) landed on
Sunday and counted toward last week. Reproduced in Dart under
`TZ=Asia/Kolkata` before changing anything.

## Why it kept recurring

- Every earlier fix was web or server code: PR #100 (capture `users.timezone`),
  `4b4f558` (activity list), `0342b6e` (manual-log forms), `079df01` (training
  load). Each audit grepped only `apps/web`.
- Flutter tests run in the CI machine's zone (UTC), where local equals UTC, so
  they pass for every version of this bug. That is the same blind spot
  `date-only-input-stored-as-utc-midnight.md` named for web tests.
- Production data looked right: the 299 Strava rows with a local timestamp
  differ from `started_at` by exactly +5:30. When data is right and the screen
  is wrong, look at how the reader groups it.

## Solution

Two kinds of date value need two different key functions
(`daily-athlete/lib/features/calendar/calendar_providers.dart`):

```dart
// A value that is already a day: planned scheduled_date, the selected day,
// range ends. Read the fields as they are.
DateTime calendarDayKey(DateTime date) =>
    DateTime.utc(date.year, date.month, date.day);

// An instant (started_at): convert to the athlete's local day first.
DateTime instantDayKey(DateTime instant) => calendarDayKey(instant.toLocal());
```

- Do not call `toLocal()` on a UTC-labelled calendar date. Review of the first
  version found that `selectedDateProvider` holds `DateTime.utc(y, m, d)`, and
  `toLocal()` moved it to the previous day west of UTC, so the Day view showed
  the wrong day. IST did not show it. The second helper exists because of that.
- `started_at` query windows must be local-midnight instants with `gte`/`lt`,
  not `'...T00:00:00Z'` / `'...T23:59:59Z'`. See `startedAtWindow` and
  `weekStartInstant` / `weekEndInstant`
  (`daily-athlete/lib/features/dashboard/dashboard_providers.dart`). The UTC
  bounds made edge-of-week workouts disappear from every view: fetched by one
  week's query, keyed into the next week's days.
- `weekStart` and `weekEnd` return calendar dates labelled UTC for
  `scheduled_date` ranges, derived from the local week. They expect a local
  input such as `DateTime.now()`.
- Strava's `start_date_local` is wall-clock time with a fake trailing `Z`.
  `StatsDetail.tsx` now formats it with `timeZone: "UTC"`. Without that it
  depends on the server's zone and is right on Vercel only because Vercel runs
  in UTC.

## Prevention

- **Audit every surface.** When a timezone bug is fixed, grep `apps/web`,
  `daily-athlete/lib` and `apps/web/src/mcp` for UTC-based day or week logic:
  `.toUtc()` before reading y/m/d, `DateTime.utc(dt.year`, `T00:00:00Z`,
  `T23:59:59Z`, `toISOString().slice(0, 10)`.
- **Tests must leave UTC.** Build fixtures from local components
  (`DateTime(2026, 10, 19, 0, 30).toUtc()`) so they fail on UTC-day code in any
  non-UTC zone. CI runs `flutter test` plain, then under `TZ=Asia/Kolkata` and
  `TZ=America/Los_Angeles` (`.github/workflows/ci.yml`).
- **Pick the key function by what the value is**: an instant gets
  `instantDayKey`, an already-a-day value gets `calendarDayKey`.

## Known gaps (not fixed by this PR)

- ~~The Flutter app never calls `/api/profile/timezone`~~ Fixed: on each
  authenticated launch `lib/features/profile/timezone_sync.dart` reads the device
  IANA zone (`flutter_timezone`, iOS + Android), compares it with
  `users.timezone`, and PATCHes with the Bearer token only on mismatch;
  failures are silent. Existing mobile-only users self-heal on their next
  launch after this ships; until then (and for users who never update) their
  rows stay `'UTC'`.
- Flutter buckets by the device zone, while AGENTS.md says the athlete zone
  lives in `users.timezone`. A coach viewing an athlete, or a traveller, gets
  the viewer's zone.
- ~~MCP `workouts_completed_list` bounds~~ Fixed: `from`/`to` are the athlete's
  local days, converted with `dayRangeInTimezone` (`apps/web/src/lib/format.ts`)
  to `[gte, lt)` instants. `workouts_completed_log` documents that `started_at`
  must carry the athlete's offset. Surfacing the zone in `profile_get` is in
  PR #102.
- The `StatsDetail` time formatter is inline, so it has no test.

## Related Issues

- `docs/solutions/athlete-timezone-capture.md` — how `users.timezone` gets
  captured on web; the mobile half is still open.
- `docs/solutions/date-only-input-stored-as-utc-midnight.md` — the write-side
  version of the same bug on web.
