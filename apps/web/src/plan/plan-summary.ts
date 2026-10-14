// Pure derivation of what a plan *contains* from its planned workouts. The
// `plans` row only carries event/status/source, so span, weekly volume, sport
// mix and "what's next" are computed here. Mirrors the mobile
// plan_summary.dart. No React, no I/O.

import { readStructureDurationSeconds } from "@/ai/planned-structure";

export interface PlanWorkoutInput {
  id: string;
  scheduled_date: string;
  sport: string;
  status: string;
  structure: Record<string, unknown> | null;
}

export interface PlanWeek {
  start: string;
  sessions: number;
  done: number;
  durationS: number;
}

export interface PlanSummary {
  weeks: PlanWeek[];
  currentWeekIndex: number | null;
  total: number;
  done: number;
  skipped: number;
  totalDurationS: number;
  sportSeconds: Array<{ sport: string; seconds: number }>;
  next: PlanWorkoutInput | null;
  thisWeek: PlanWorkoutInput[];
}

/** Monday (YYYY-MM-DD) of the ISO week containing a YYYY-MM-DD date. */
export function mondayOf(dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/** Today's YYYY-MM-DD in the given IANA timezone. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatDurationShort(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function summarizePlan(workouts: PlanWorkoutInput[], today: string): PlanSummary {
  const sorted = [...workouts].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  const byWeek = new Map<string, PlanWeek>();
  const sportTotals = new Map<string, number>();
  let done = 0;
  let skipped = 0;

  for (const w of sorted) {
    const start = mondayOf(w.scheduled_date);
    const week = byWeek.get(start) ?? { start, sessions: 0, done: 0, durationS: 0 };
    const seconds = readStructureDurationSeconds(w.structure) ?? 0;
    week.sessions += 1;
    week.durationS += seconds;
    if (w.status === "completed") {
      week.done += 1;
      done += 1;
    }
    if (w.status === "skipped") skipped += 1;
    byWeek.set(start, week);
    sportTotals.set(w.sport, (sportTotals.get(w.sport) ?? 0) + seconds);
  }

  const weeks = [...byWeek.values()].sort((a, b) => a.start.localeCompare(b.start));
  const thisMonday = mondayOf(today);
  const currentIdx = weeks.findIndex((w) => w.start === thisMonday);

  return {
    weeks,
    currentWeekIndex: currentIdx === -1 ? null : currentIdx,
    total: sorted.length,
    done,
    skipped,
    totalDurationS: weeks.reduce((sum, w) => sum + w.durationS, 0),
    sportSeconds: [...sportTotals.entries()]
      .map(([sport, seconds]) => ({ sport, seconds }))
      .filter((s) => s.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds),
    next: sorted.find((w) => w.status === "planned" && w.scheduled_date >= today) ?? null,
    thisWeek: sorted.filter((w) => mondayOf(w.scheduled_date) === thisMonday),
  };
}
