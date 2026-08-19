// Period calendar: converting between an athlete-local period and the UTC
// instants that bound it (U3, KTD4).
//
// All timestamps in this repo are stored UTC and the athlete's timezone lives
// on `users.timezone`, applied at the read/render boundary (AGENTS.md). This
// module IS that boundary for period reviews.
//
// Pure functions -- no DB, no ambient clock (every entry point takes `now`
// explicitly) -- so the DST and year-boundary behaviour is unit-testable.
//
// This extends the vocabulary already established in
// apps/web/src/ai/adaptive/schedule.ts (`localPartsInTimezone`,
// `weeklyReviewWeekKey`) rather than starting a second timezone idiom. The one
// thing that module does not have -- and this feature needs -- is the INVERSE
// direction: given a local calendar day, what UTC instant does it begin at.
// That is `zonedMidnightUtc` below.
//
// WHY HALF-OPEN RANGES. `periodRangeUtc` returns `[startUtc, endUtc)`. A closed
// range needs an end instant that is "the last moment of the period", which has
// no exact representation (23:59:59.999? .999999?) and silently drops a workout
// logged in the gap. Half-open has no gap: an instant belongs to exactly one
// period, and the period's own key round-trips through `periodKeyForInstant`.

import type { PeriodBounds, PeriodKind } from "@da2/shared";
import { isValidPeriodKey } from "@da2/shared";

import { localPartsInTimezone } from "@/ai/adaptive/schedule";

/** Thrown when a period key is malformed or does not match its kind. Distinct
 * from "no data for that period" -- callers map this to a 4xx, not an empty
 * report. */
export class InvalidPeriodKeyError extends Error {
  constructor(kind: PeriodKind, key: string) {
    super(`invalid ${kind} period key: ${JSON.stringify(key)}`);
    this.name = "InvalidPeriodKeyError";
  }
}

function assertKey(kind: PeriodKind, key: string): void {
  if (!isValidPeriodKey(kind, key)) throw new InvalidPeriodKeyError(kind, key);
}

// ---------------------------------------------------------------------------
// Local-day <-> UTC-instant conversion
// ---------------------------------------------------------------------------

/**
 * Offset of `timezone` from UTC at `instant`, in milliseconds (positive east).
 *
 * Formats the instant as wall-clock parts in the target zone, then reads those
 * parts back as if they were UTC. The difference IS the offset. This is the
 * standard approach and the only one that stays correct across DST without
 * shipping a timezone database.
 *
 * Falls back to a zero offset for an unparseable zone, matching
 * `localPartsInTimezone`'s UTC fallback -- `users.timezone` is athlete-supplied
 * and one bad row must not throw the whole scheduler sweep.
 */
function zoneOffsetMs(timezone: string, instant: Date): number {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "UTC",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return 0;
  }

  const parts = fmt.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24, // Intl can render midnight as "24"
    get("minute"),
    get("second"),
  );
  return asIfUtc - instant.getTime();
}

/**
 * The UTC instant at which the given local calendar day BEGINS in `timezone`.
 *
 * Two-pass: guess by treating the local wall time as UTC, measure the offset at
 * that guess, correct, then re-measure at the corrected instant. The second
 * pass is what makes DST transitions land correctly -- a single pass uses the
 * offset from the wrong side of the transition for days near it.
 *
 * On a spring-forward day in a zone that transitions AT midnight (e.g. some
 * South American zones), local midnight does not exist. The two-pass converges
 * on the instant the day actually starts, which is the correct and only useful
 * answer; it is never NaN or a throw.
 */
function zonedMidnightUtc(timezone: string, localDay: string): Date {
  const [y, m, d] = localDay.split("-").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0);

  let ts = wallAsUtc - zoneOffsetMs(timezone, new Date(wallAsUtc));
  ts = wallAsUtc - zoneOffsetMs(timezone, new Date(ts));
  return new Date(ts);
}

// ---------------------------------------------------------------------------
// Calendar arithmetic (pure, UTC-stable -- operates on local Y/M/D only)
// ---------------------------------------------------------------------------

function toDay(dateUtc: Date): string {
  return dateUtc.toISOString().slice(0, 10);
}

/** Add `n` days to a "YYYY-MM-DD" local day. UTC math on a bare date is safe
 * here precisely because there is no time component to shift. */
function addLocalDays(localDay: string, n: number): string {
  const [y, m, d] = localDay.split("-").map(Number);
  return toDay(new Date(Date.UTC(y, m - 1, d + n)));
}

/** ISO-8601 week ordinal for a local Y/M/D. Week 1 is the week containing the
 * year's first Thursday, so the ISO YEAR can differ from the calendar year at
 * either end -- 2025-12-29 is 2026-W01, and 2027-01-01 is 2026-W53. */
function isoWeekParts(year: number, month: number, day: number): {
  isoYear: number;
  isoWeek: number;
} {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of this week
  const isoYear = date.getUTCFullYear();

  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);

  const isoWeek =
    1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return { isoYear, isoWeek };
}

/** The local day on which ISO week `isoWeek` of `isoYear` begins (a Monday). */
function isoWeekStartDay(isoYear: number, isoWeek: number): string {
  // Jan 4 is always in ISO week 1, by definition.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7; // Mon=0
  const week1Monday = new Date(Date.UTC(isoYear, 0, 4 - jan4DayNum));
  week1Monday.setUTCDate(week1Monday.getUTCDate() + (isoWeek - 1) * 7);
  return toDay(week1Monday);
}

/** Number of ISO weeks in an ISO year (52 or 53). */
function isoWeeksInYear(isoYear: number): number {
  // Dec 28 is always in the year's last ISO week, by definition.
  return isoWeekParts(isoYear, 12, 28).isoWeek;
}

function formatWeekKey(isoYear: number, isoWeek: number): string {
  return `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
}

function formatMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Which period does `instant` fall in, from the athlete's point of view?
 *
 * This is the function that makes a workout logged at 23:50 local on Sunday
 * belong to the closing week rather than the next one.
 */
export function periodKeyForInstant(
  kind: PeriodKind,
  timezone: string,
  instant: Date,
): string {
  const p = localPartsInTimezone(timezone, instant);
  if (kind === "monthly") return formatMonthKey(p.year, p.month);
  const { isoYear, isoWeek } = isoWeekParts(p.year, p.month, p.day);
  return formatWeekKey(isoYear, isoWeek);
}

/**
 * The period's local calendar bounds. `end` is INCLUSIVE -- the last local day
 * -- matching the DATE columns in migration 0029 and how a human reads "the
 * week of the 10th through the 16th".
 *
 * Timezone-independent: a period key names the same local days everywhere.
 * Converting those days to instants is `periodRangeUtc`'s job.
 */
export function periodBounds(kind: PeriodKind, key: string): PeriodBounds {
  assertKey(kind, key);

  if (kind === "monthly") {
    const [year, month] = key.split("-").map(Number);
    const start = `${key}-01`;
    // Day 0 of the NEXT month is the last day of this one -- handles 28/29/30/31
    // without a lookup table or a leap-year branch.
    const end = toDay(new Date(Date.UTC(year, month, 0)));
    return { start, end };
  }

  const [isoYearStr, weekStr] = key.split("-W");
  const start = isoWeekStartDay(Number(isoYearStr), Number(weekStr));
  return { start, end: addLocalDays(start, 6) };
}

/**
 * The half-open UTC instant range `[startUtc, endUtc)` covering the period in
 * the athlete's timezone. This is what a `completed_workouts.started_at` query
 * filters on.
 *
 * NOT `start + 7 * 24h`: a DST-transition week is 167 or 169 hours long, and
 * computing the end by addition silently drops or double-counts a workout at
 * the edge. Both ends are resolved independently through the zone.
 */
export function periodRangeUtc(
  kind: PeriodKind,
  key: string,
  timezone: string,
): { startUtc: Date; endUtc: Date } {
  const { start, end } = periodBounds(kind, key);
  return {
    startUtc: zonedMidnightUtc(timezone, start),
    // Local midnight of the day AFTER the period's last day -- the exclusive
    // upper bound.
    endUtc: zonedMidnightUtc(timezone, addLocalDays(end, 1)),
  };
}

/** The period immediately preceding `key`. Handles the ISO-year boundary,
 * where the predecessor of week 1 is week 52 or 53 depending on whether the
 * previous ISO year was long. */
export function previousPeriodKey(kind: PeriodKind, key: string): string {
  assertKey(kind, key);

  if (kind === "monthly") {
    const [year, month] = key.split("-").map(Number);
    return month === 1 ? formatMonthKey(year - 1, 12) : formatMonthKey(year, month - 1);
  }

  const [isoYearStr, weekStr] = key.split("-W");
  const isoYear = Number(isoYearStr);
  const isoWeek = Number(weekStr);
  if (isoWeek > 1) return formatWeekKey(isoYear, isoWeek - 1);
  return formatWeekKey(isoYear - 1, isoWeeksInYear(isoYear - 1));
}

/**
 * The most recent COMPLETED periods, newest first.
 *
 * The in-flight period is deliberately excluded: a review of a week that is
 * still running is a half-report whose numbers change under the athlete, and
 * whose narration would be written about an incomplete week. The API rejects a
 * request for it for the same reason.
 */
export function enumerateRecentPeriods(
  kind: PeriodKind,
  timezone: string,
  now: Date,
  count: number,
): string[] {
  if (count <= 0) return [];

  const keys: string[] = [];
  let key = previousPeriodKey(kind, periodKeyForInstant(kind, timezone, now));
  for (let i = 0; i < count; i += 1) {
    keys.push(key);
    key = previousPeriodKey(kind, key);
  }
  return keys;
}

/**
 * True when `key` names a period that has already closed in the athlete's
 * timezone as of `now`. The API's guard against generating a review for a week
 * that is still running.
 */
export function isPeriodClosed(
  kind: PeriodKind,
  key: string,
  timezone: string,
  now: Date,
): boolean {
  const { endUtc } = periodRangeUtc(kind, key, timezone);
  return now.getTime() >= endUtc.getTime();
}

/**
 * The athlete's local calendar day ("YYYY-MM-DD") for an instant. The unit in
 * which "active days" is counted -- two sessions either side of local midnight
 * are two days even when they share a UTC date.
 */
export function localDayInTimezone(timezone: string, instant: Date): string {
  const p = localPartsInTimezone(timezone, instant);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
