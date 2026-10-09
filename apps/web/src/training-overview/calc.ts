import { addDays, dayDiff } from "@/training-load/load-series";

export const OVERVIEW_WEEKS = 10;

export interface OverviewWorkout {
  day: string;
  sport: string;
  durationS: number;
}

export interface WeeklyBucket {
  weekStart: string;
  bySport: Record<string, number>;
  totalH: number;
}

export interface SportRow {
  sport: string;
  sessions28: number;
  hours28: number;
  sessionsAll: number;
  hoursAll: number;
}

export interface Last28 {
  hours: number;
  prevHours: number;
  deltaPct: number | null;
}

const MIN_SESSION_S = 60;

export function normalizeSport(sport: string): string {
  const s = sport.toLowerCase();
  return s === "ride" ? "bike" : s;
}

export function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

function countable(workouts: OverviewWorkout[]): OverviewWorkout[] {
  return workouts.filter((w) => w.durationS >= MIN_SESSION_S);
}

export function weeklyBuckets(
  workouts: OverviewWorkout[],
  today: string,
  weeks = OVERVIEW_WEEKS,
): WeeklyBucket[] {
  const currentMonday = mondayOf(today);
  const buckets = new Map<string, WeeklyBucket>();
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = addDays(currentMonday, -7 * i);
    buckets.set(weekStart, { weekStart, bySport: {}, totalH: 0 });
  }
  for (const w of countable(workouts)) {
    const bucket = buckets.get(mondayOf(w.day));
    if (!bucket) continue;
    const hours = w.durationS / 3600;
    const sport = normalizeSport(w.sport);
    bucket.bySport[sport] = (bucket.bySport[sport] ?? 0) + hours;
    bucket.totalH += hours;
  }
  return [...buckets.values()];
}

export function last28(workouts: OverviewWorkout[], today: string): Last28 {
  let hours = 0;
  let prevHours = 0;
  for (const w of countable(workouts)) {
    const age = dayDiff(w.day, today);
    if (age >= 0 && age < 28) hours += w.durationS / 3600;
    else if (age >= 28 && age < 56) prevHours += w.durationS / 3600;
  }
  return { hours, prevHours, deltaPct: prevHours > 0 ? (hours - prevHours) / prevHours : null };
}

export function bySport(workouts: OverviewWorkout[], today: string): SportRow[] {
  const rows = new Map<string, SportRow>();
  for (const w of countable(workouts)) {
    const sport = normalizeSport(w.sport);
    const row = rows.get(sport) ?? { sport, sessions28: 0, hours28: 0, sessionsAll: 0, hoursAll: 0 };
    const hours = w.durationS / 3600;
    row.sessionsAll += 1;
    row.hoursAll += hours;
    const age = dayDiff(w.day, today);
    if (age >= 0 && age < 28) {
      row.sessions28 += 1;
      row.hours28 += hours;
    }
    rows.set(sport, row);
  }
  return [...rows.values()].sort((a, b) => b.hoursAll - a.hoursAll);
}

export function formVerdict(tsb: number): string {
  if (tsb > 5) return "fresh";
  if (tsb >= -10) return "neutral";
  if (tsb >= -30) return "carrying heavy load";
  return "very fatigued";
}

export function daysUntil(raceDay: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(raceDay)) return null;
  const days = dayDiff(today, raceDay.slice(0, 10));
  return Number.isNaN(days) || days < 0 ? null : days;
}
