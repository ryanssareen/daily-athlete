// Athlete-local scheduling for the B1 weekly review (Unit 8). An hourly cron
// fires in UTC; this decides which athletes are "due" right now (Sunday ~18:00
// in their own timezone) and produces a per-athlete ISO-week idempotency key so
// overlapping ticks / a timezone change can't double-enqueue. See
// docs/plans/2026-05-25-001-feat-ai-adaptive-plans-engine-plan.md (Unit 8).
//
// Pure functions (no DB, no clock dependency beyond the passed-in `now`) so the
// DST / UTC-default behavior is unit-testable.

// The local hour (0-23) at which the weekly review fires.
export const WEEKLY_REVIEW_LOCAL_HOUR = 18; // ~6pm local

type LocalParts = {
  weekday: number; // 0 = Sunday .. 6 = Saturday
  hour: number; // 0-23
  year: number;
  month: number; // 1-12
  day: number; // 1-31
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Resolve the wall-clock parts of `now` in the given IANA timezone. Falls back
 * to UTC if the timezone string is invalid (mirrors the users.timezone default
 * of 'UTC').
 */
export function localPartsInTimezone(timezone: string, now: Date): LocalParts {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "UTC",
      weekday: "short",
      hour: "2-digit",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      hour: "2-digit",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // Intl can render midnight as "24"; normalize to 0.
  const hour = Number(get("hour")) % 24;
  return {
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
    hour,
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
  };
}

/**
 * True when, in the athlete's timezone, `now` falls in the Sunday 18:00 hour.
 * The hourly cron calls this per athlete; exactly one tick per week matches.
 */
export function isWeeklyReviewDue(timezone: string, now: Date): boolean {
  const p = localPartsInTimezone(timezone, now);
  return p.weekday === 0 && p.hour === WEEKLY_REVIEW_LOCAL_HOUR;
}

/**
 * ISO-week ordinal for a proleptic Gregorian Y/M/D (ISO-8601: weeks start
 * Monday; week 1 contains the year's first Thursday).
 */
function isoWeekParts(year: number, month: number, day: number): { isoYear: number; isoWeek: number } {
  // UTC math on the local Y/M/D avoids tz double-counting.
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  // Thursday of this week determines the ISO year.
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  const isoWeek = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return { isoYear, isoWeek };
}

/**
 * Per-athlete idempotency key for the current athlete-local ISO week, e.g.
 * "2026-W22". Used to ensure one weekly-review enqueue per athlete per week.
 */
export function weeklyReviewWeekKey(timezone: string, now: Date): string {
  const p = localPartsInTimezone(timezone, now);
  const { isoYear, isoWeek } = isoWeekParts(p.year, p.month, p.day);
  return `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
}
