---
title: Date-Only Input Stored as UTC Midnight (manual workout started_at)
date: 2026-10-12
status: active
module: apps/web athlete manual workout logging
problem_type: logic_error
component: frontend
symptoms:
  - "A run logged for Oct 12 by an athlete in IST displayed as Oct 12, 5:30 AM (a fabricated start time)"
  - For athletes west of UTC the same workout displayed on the previous day (Oct 11, 8 PM)
  - The quick-log dialog pre-filled the UTC day, which is wrong before 05:30 IST and on evenings west of UTC
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [timezone, started-at, date-input, manual-workout, utc, local-day, calendar-day]
related_components: [athlete_timezone, workout_detail_pages, mobile_manual_log_sheet]
---

# Date-Only Input Stored as UTC Midnight (manual workout `started_at`)

How both web manual-log forms turned a picked calendar day into a fabricated
instant at UTC midnight, why it showed a made-up clock time east of UTC and
the wrong day west of it, and the general rule: a date-only input is a
calendar day in the user's zone, not an instant. Fixed in the commit
"fix(web): log manual workouts on the athlete's local day, not UTC midnight"
(`0342b6e`, pushed straight to `main`, no PR).

## Problem

The web forms for logging a manual workout have a date picker and no time
picker. Both sent the picked day to `/api/activities/manual` as:

```ts
started_at: `${date}T00:00:00+00:00`,
```

That string is a real instant, midnight UTC, and the API stores it as one.
`apps/web/app/api/activities/manual/route.ts:33` accepts any offset-bearing
ISO datetime (`z.string().datetime({ offset: true })`) and writes it through
unchanged. Nothing downstream knows the time part was invented.

Every surface that renders or buckets workouts converts `started_at` into the
athlete's timezone (`public.users.timezone`), which is the correct read-side
behaviour per AGENTS.md:

- `formatWorkoutDateTime` (`apps/web/src/lib/format.ts`) formats date and
  time with `timeZone: tz`.
- `calendarDayInTimezone` (`apps/web/src/lib/format.ts`) derives the
  `YYYY-MM-DD` day bucket in the athlete's zone.

UTC midnight converted to any non-UTC zone stops being midnight on the
picked day:

| Athlete timezone | Stored `started_at`      | Renders as            |
| ---------------- | ------------------------ | --------------------- |
| Asia/Calcutta    | `2026-10-12 00:00:00+00` | Oct 12, 5:30 AM       |
| America/New_York | `2026-10-12 00:00:00+00` | **Oct 11**, 8:00 PM   |

East of UTC you get the right day with a fake clock time. West of UTC you get
the **previous day**: wrong on the calendar, the activities list, the detail
page, and anything that buckets by day (daily load, plan matching).

The quick-log dialog had a second, independent bug: it defaulted the date
input to `new Date().toISOString().split("T")[0]`, which is the UTC day, not
the athlete's. Before 05:30 in IST it pre-fills yesterday; on any evening
west of UTC it pre-fills tomorrow.

## Symptoms

- Found during a local e2e run against local Supabase. A run logged for
  Oct 12 with no time showed "Oct 12 · 5:30 AM" on the detail page for an
  athlete with `users.timezone = 'Asia/Calcutta'`. The row had
  `started_at = 2026-10-12 00:00:00+00`.
- The same row for an `America/New_York` athlete renders as Oct 11, 8:00 PM.
- Any manual web entry whose time is exactly `00:00:00` UTC is a symptom of
  this. Mobile entries carry real times (see Why This Works).

## What Didn't Work

- **Blaming the recent timezone-aware list change.** The first theory was a
  regression from "fix(web): use athlete timezone for activity dates instead
  of hardcoded UTC" (`4b4f558`, Sep 2026). It wasn't. The detail page and
  calendar were already timezone-aware, and the `T00:00:00+00:00`
  construction came in with the original forms in May 2026: "feat(web): log
  workout dialog + mark as done UI (Units 5+6)" (`a7a1150`) and
  "feat(web): /athlete/workouts/new — full-page workout logging form"
  (`f634760`). `4b4f558` only removed the
  last surface that was still rendering in UTC, which had been hiding the bad
  data there. When a display fix "causes" a wrong value to appear, look at
  how the value was written before blaming the display.
- **Fixing only the `started_at` construction.** The first version of the fix
  replaced the UTC-midnight string with a new helper and left the dialog's
  `toISOString().split("T")[0]` default alone. Code review (the correctness
  and adversarial reviewers each found it independently) showed the two
  together were worse than before. On an evening in Los Angeles the dialog
  pre-fills tomorrow's UTC date. That no longer matches "today locally", so
  the helper takes the "other day" branch and stores tomorrow at local noon:
  a workout logged in the **future**. Both sides of the conversion, the
  default "today" and the day-to-instant step, have to use the same local
  calendar.
- **The August timezone audit looked only at reads.** When
  `users.timezone` was first captured (see
  `docs/solutions/athlete-timezone-capture.md`), the audit searched for
  UTC-based *reads* (`getUTCHours`, `formatWorkoutDateTime`, `toISOString`
  in display code). It never looked at how `started_at` was *written* from a
  date-only form input, so this bug survived it. (session history)

## Solution

Two helpers in `apps/web/src/lib/format.ts`, used by both forms.

`localDay` gives today's date in the browser's local zone, built from
local-time getters:

```ts
export function localDay(now: Date = new Date()): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}
```

`manualStartedAt` turns a picked day into an instant:

```ts
export function manualStartedAt(day: string, now: Date = new Date()): string {
  const [y, m, d] = day.split("-").map(Number);
  const sameLocalDay =
    now.getFullYear() === y && now.getMonth() + 1 === m && now.getDate() === d;
  if (sameLocalDay) return now.toISOString();
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}
```

Call sites, before and after.

`apps/web/app/(athlete)/athlete/LogWorkoutDialog.tsx`:

```ts
// before
setDate(new Date().toISOString().split("T")[0]);
// ...
started_at: `${date}T00:00:00+00:00`,

// after
setDate(localDay());
// ...
started_at: manualStartedAt(date),
```

`apps/web/app/(athlete)/athlete/workouts/new/page.tsx`. This page already
had a correct private `todayLocal()`, now replaced by the shared helper:

```ts
// before
const [date, setDate] = useState(todayLocal);
// ...
started_at: `${date}T00:00:00+00:00`,

// after
const [date, setDate] = useState(() => localDay());
// ...
started_at: manualStartedAt(date),
```

Browser check after the fix: an entry for Oct 5 is stored as 06:30 UTC
(noon IST) and renders "Oct 5 · 12:00 PM".

## Why This Works

- **Today means now.** If the athlete picks today, the best guess is that
  they just finished the workout. That is also what mobile does:
  `daily-athlete/lib/features/activities/manual_log_sheet.dart` defaults
  `_date` to `DateTime.now()` and sends `_date.toUtc().toIso8601String()`,
  a real instant.
- **Other days mean local noon, not local midnight.** The instant is built
  in the browser's zone but rendered in the profile zone (`users.timezone`).
  Those can differ: a travelling athlete, or a session before
  `TimezoneSync` has corrected the stored value (see
  `docs/solutions/athlete-timezone-capture.md`). Local midnight sits on the
  day boundary, so even a 1h difference moves it to another day. Noon stays
  on the picked day for any browser/profile difference up to ±12h.
- **Local-time constructor components, never string parsing.**
  `new Date(y, m - 1, d, 12)` reads its arguments as local time.
  `new Date("2026-10-05")` is parsed as **UTC** midnight (date-only ISO
  strings are the one ISO form JS treats as UTC), which is the same bug
  again. The plan-history pages hit exactly this in August with a DATE-only
  `event_date` passed to `new Date(str)`. (session history)
- **One shared definition of "today".** `localDay()` and the
  `sameLocalDay` check in `manualStartedAt` both use local getters, so the
  default the form shows is always the day the helper treats as "today". The
  LA-evening future-dating case can't happen.

### Known limitations

- **Beyond ±12h drift.** An IST profile with an LA browser is 12.5h apart,
  so a past-dated entry can still move by a day. Only a time picker, or
  building the instant in the profile timezone, would close that.
- **No future check at the API.** `/api/activities/manual` doesn't reject a
  future `started_at` (it only validates the format), so a client bug like
  the one above would be stored without complaint.
- **Existing rows not backfilled.** Rows logged on web before the fix still
  have UTC midnight. They can't be reliably told apart from real entries:
  `source = 'manual'` covers both clients and nothing records which client
  wrote a row. So they were left alone.
- **Mobile past-dated entries.** A day picked on mobile comes back from
  `showDatePicker` as local midnight, so it has the drift sensitivity that
  noon avoids on web. Not changed in this fix.

## Prevention

- **Rule:** never append `T00:00:00Z` / `T00:00:00+00:00` to a user-picked
  date to make a `TIMESTAMPTZ`. A date-only input is a calendar day in the
  user's zone. If the column is an instant, choose the instant on purpose
  (now, or local noon) with local-time `Date` components. If the value
  really is just a day, store a `DATE` instead.
- **Never use `toISOString().split("T")[0]` or `toISOString().slice(0, 10)`
  for "today".** That's the UTC day. Use `localDay()` in the browser, or
  `calendarDayInTimezone(now, users.timezone)` when the profile zone is what
  counts.
- **Grep for recurrences** in any code that writes, renders, or filters by a
  day: `T00:00:00` near `started_at` (or any other timestamp field),
  `toISOString().split("T")[0]`, `toISOString().slice(0, 10)`, and
  `new Date("YYYY-MM-DD")`-style parsing of a picked or stored date.
- **Not every `T00:00:00Z` is a bug.** Calendar-day arithmetic that stays in
  UTC from start to finish is fine. For example,
  `apps/web/src/training-load/load-series.ts` uses
  `Date.parse(\`${day}T00:00:00Z\`)` only to count and add days on
  `YYYY-MM-DD` keys, and never stores or renders the result as an instant.
  The bug is when a day becomes a stored or rendered instant, or when "today"
  is taken from the UTC clock.
- **Test across zones by setting `process.env.TZ`**, the way
  `apps/web/src/lib/__tests__/format.test.ts` does (Node re-reads `TZ` on
  assignment; restore it in `afterEach`, and `delete` it rather than
  assigning `undefined`). The core assertion is a round-trip — write a day,
  read it back through `calendarDayInTimezone` in the athlete's zone, get the
  same day:

  ```ts
  for (const tz of ["America/Los_Angeles", "America/New_York", "UTC",
                    "Asia/Calcutta", "Pacific/Auckland"]) {
    process.env.TZ = tz;
    const startedAt = manualStartedAt("2026-10-05", new Date("2026-10-12T09:00:00Z"));
    expect(calendarDayInTimezone(startedAt, tz)).toBe("2026-10-05");
  }

  // West-of-UTC evening: default day and "today" agree, no future date
  process.env.TZ = "America/Los_Angeles";
  const eve = new Date("2026-10-13T03:00:00Z");
  expect(localDay(eve)).toBe("2026-10-12");
  expect(manualStartedAt(localDay(eve), eve)).toBe(eve.toISOString());
  ```

  Any new code path that turns a day into an instant should have one, run
  under at least one zone east and one west of UTC. A test run only in the CI
  machine's default zone (usually UTC) passes for every version of this bug.
- **Pair the default with the conversion in review.** When a form converts
  a picked day to an instant, check where the field's default "today" comes
  from in the same review. The two have to agree on which calendar they use.

## Related Issues

- `docs/solutions/athlete-timezone-capture.md` — how `users.timezone` gets
  captured; the read-side half of this story.
- `docs/solutions/migration-conventions.md` — the "store UTC, apply athlete
  timezone at the read/render boundary" invariant. This doc is its
  write-side corollary: a date-only input has no instant until the client
  picks one in the athlete's local day.
- Same class, read side, fixed in a follow-up: the dashboard's "next 7 days"
  window and "This week" totals, the calendar's default week, fetch range,
  day grouping and today-highlight, and the weekly-review apply step's
  "today" all used the UTC day or UTC week. Training-load series also
  bucketed `started_at` by UTC date while `asOf` was athlete-local; callers
  now pass inputs through `localizeLoadInputs`
  (`apps/web/src/training-load/load-series.ts`) first.
