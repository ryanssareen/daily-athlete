/** h:mm:ss for workouts >= 1 hour, m:ss otherwise. Returns "—" if null. */
export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Formats distance based on sport:
 * - swim → meters (e.g. "400 m")
 * - all others → km (e.g. "5.2 km")
 * Returns "—" if null.
 */
export function formatDistance(meters: number | null, sport: string): string {
  if (meters == null) return "—";
  if (sport === "swim") {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Returns formatted pace/speed string, or null if the sport doesn't show it.
 * - run: "m:ss /km" (pace)
 * - swim: "m:ss /100m" (pace)
 * - bike: "X.X km/h" (speed)
 * - strength/mobility/other: null
 */
export function formatPace(
  meters: number | null,
  seconds: number | null,
  sport: string
): string | null {
  if (sport === "strength" || sport === "mobility" || sport === "other") {
    return null;
  }
  if (meters == null || meters <= 0 || seconds == null || seconds <= 0) {
    return null;
  }
  if (sport === "bike") {
    const kmh = (meters / 1000) / (seconds / 3600);
    return `${kmh.toFixed(1)} km/h`;
  }
  // run and swim: pace per unit
  const unit = sport === "swim" ? 100 : 1000;
  const paceSeconds = (seconds / meters) * unit;
  const pm = Math.floor(paceSeconds / 60);
  const ps = Math.floor(paceSeconds % 60);
  const label = sport === "swim" ? "/100m" : "/km";
  return `${pm}:${ps.toString().padStart(2, "0")} ${label}`;
}

/**
 * The CALENDAR DAY a UTC instant falls on in a given IANA timezone, as
 * `YYYY-MM-DD`.
 *
 * Why this exists as its own helper rather than `iso.split("T")[0]`: a bare
 * UTC date is not the day the athlete trained. For an athlete at UTC+5:30,
 * anything started before 05:30 local lands on the PREVIOUS UTC date; for
 * negative offsets, a late-evening session lands on the NEXT one. Anywhere we
 * compare an instant against a stored calendar day — most importantly
 * `planned_workouts.scheduled_date`, which is a bare DATE meaning "the day the
 * athlete was meant to do this" — the comparison has to be made in the
 * athlete's own timezone or it silently mis-files roughly one session in ten
 * for an early-morning trainer.
 *
 * `en-CA` is used because its short date format is ISO-ordered
 * (`YYYY-MM-DD`), which is the shape every caller wants; the locale is an
 * implementation detail, not a user-facing choice. An unknown/invalid
 * timezone falls back to UTC rather than throwing — a mis-dated match is
 * recoverable, a crashed ingest is not.
 */
export function calendarDayInTimezone(startedAt: string, timezone: string | null | undefined): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return startedAt.split("T")[0];
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
}

/** Offset (ms) of `timezone` from UTC at the instant `at`; 0 for an invalid zone. */
function zoneOffsetMs(at: number, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(at));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return asUtc - Math.floor(at / 1000) * 1000;
  } catch {
    return 0;
  }
}

/**
 * The UTC instant (ISO string) at which calendar day `day` (`YYYY-MM-DD`)
 * begins in `timezone`. Independent of the server process's own TZ. An
 * invalid/missing zone falls back to UTC, matching `calendarDayInTimezone`.
 */
export function localDayStartInstant(day: string, timezone: string | null | undefined): string {
  const [y, m, d] = day.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d);
  const tz = timezone || "UTC";
  // Two passes: the offset at the first guess may differ across a DST edge.
  let instant = naive - zoneOffsetMs(naive, tz);
  instant = naive - zoneOffsetMs(instant, tz);
  return new Date(instant).toISOString();
}

/**
 * Half-open instant range `[gte, lt)` covering local days `from..to`
 * inclusive in `timezone`. Either side may be omitted (open-ended). Use with
 * `.gte("started_at", gte).lt("started_at", lt)` — a bare `YYYY-MM-DD` compared
 * to a timestamptz is UTC midnight, which is wrong for any non-UTC athlete.
 */
export function dayRangeInTimezone(
  from: string | undefined,
  to: string | undefined,
  timezone: string | null | undefined
): { gte?: string; lt?: string } {
  const range: { gte?: string; lt?: string } = {};
  if (from) range.gte = localDayStartInstant(from, timezone);
  if (to) {
    const [y, m, d] = to.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    range.lt = localDayStartInstant(next, timezone);
  }
  return range;
}

/**
 * Formats a UTC ISO string into a human-readable date + time in the athlete's
 * local timezone. Example output: "May 12 · 7:14 AM"
 */
export function formatWorkoutDateTime(startedAt: string, timezone: string): string {
  const date = new Date(startedAt);
  const tz = timezone || "UTC";
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  return `${dateStr} · ${timeStr}`;
}

/**
 * Today's date in the browser's local timezone as `YYYY-MM-DD` — the default
 * for an `<input type="date">`. Not `toISOString().split("T")[0]`, which is
 * the UTC day and is wrong for anyone whose local date differs from UTC's
 * (before 05:30 in IST, evenings west of UTC).
 */
export function localDay(now: Date = new Date()): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/**
 * Converts a date-only manual-log entry (`YYYY-MM-DD`, from an
 * `<input type="date">`) into the `started_at` instant sent to
 * `/api/activities/manual`.
 *
 * The forms have no time picker, so the instant is chosen to land on the
 * picked calendar day wherever it is rendered:
 * - today → `now`, matching the mobile app's default for a just-finished session;
 * - any other day → 12:00 in the browser's local timezone. Noon keeps the
 *   session on the right day even when the profile timezone differs from the
 *   browser's by up to ±12h (e.g. while travelling).
 *
 * Never `${day}T00:00:00Z`: UTC midnight renders as the previous evening for
 * every athlete west of UTC once dates are shown in the athlete's timezone.
 */
export function manualStartedAt(day: string, now: Date = new Date()): string {
  const [y, m, d] = day.split("-").map(Number);
  const sameLocalDay =
    now.getFullYear() === y && now.getMonth() + 1 === m && now.getDate() === d;
  if (sameLocalDay) return now.toISOString();
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}
