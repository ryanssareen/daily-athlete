// B2 missed-block detector (Unit 9).
//
// PURE FUNCTION (no I/O, no DB, no ambient clock) so it is unit-testable the
// same way `apps/web/src/training-load/load-series.ts` is. The Inngest cron
// (`adaptive-detectors.ts`) does the DB reads and feeds this the rows.
//
// "Missed" workout rule (don't cram — Joe Friel / plan External References):
//   A planned_workout is MISSED when ALL of:
//     - status === 'planned'        (NOT 'skipped'/'moved'/'completed' — those
//                                     are intentional or already done)
//     - its scheduled day is past END-OF-ATHLETE-LOCAL-DAY by >= graceHours
//       (default 36h) — so a same-day or webhook-lagging workout is NOT flagged
//     - it has NO live workout_matches row (a live match = the athlete actually
//       did it; matching can lag, hence the grace window)
//
// The contiguous gap of missed days is bucketed to frame the engine's reflow
// (never make-up/cram):
//   '<=3d' resume as-is | '4-7d' unplanned rest week |
//   '1-2w' regress a phase | '>2w' back up a block
// https://joefrieltraining.com/missed-workouts/

import { localPartsInTimezone } from "@/ai/adaptive/schedule";

export type MissedBlockBucket = "<=3d" | "4-7d" | "1-2w" | ">2w";

/** Minimal planned-workout shape the detector reads. Structural, not a DB row. */
export interface DetectorPlannedWorkout {
  id: string;
  /** Athlete-local calendar day the workout is scheduled for, "YYYY-MM-DD". */
  scheduled_date: string;
  /** planned | completed | skipped | moved (only 'planned' can be "missed"). */
  status: string;
}

/** Minimal live workout_matches shape (deleted_at IS NULL filtered upstream). */
export interface DetectorMatch {
  /** The planned_workouts.id this match links to. */
  planned_workout_id: string;
}

export interface DetectMissedBlockInput {
  plannedWorkouts: DetectorPlannedWorkout[];
  /** Live (non-deleted) matches only. The caller filters `deleted_at IS NULL`. */
  matches: DetectorMatch[];
  /** Athlete IANA timezone (defaults to UTC upstream). */
  timezone: string;
  /** "Now" — the detector resolves athlete-local today from this. */
  now: Date;
  /** Hours past end-of-local-day before a planned workout counts as missed. */
  graceHours?: number;
}

export interface DetectMissedBlockResult {
  missed: boolean;
  /** Earliest missed scheduled_date, "YYYY-MM-DD" — the stable dedup anchor. */
  firstMissedDate?: string;
  /** Count of distinct missed planned workouts in the most-recent gap. */
  missedCount: number;
  /** Bucket of the contiguous gap span (in days) for engine framing. */
  bucket: MissedBlockBucket;
}

const DEFAULT_GRACE_HOURS = 36;

/** Days between two "YYYY-MM-DD" keys (b − a), calendar days. UTC-stable. */
function dayDiff(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((tb - ta) / 86_400_000);
}

/**
 * Bucket a contiguous-gap span (in calendar days, inclusive of both ends) into
 * the plan's named missed-workout strategy. A 1-day gap and a 3-day gap both
 * "<=3d"; 5 days is an unplanned rest week; etc.
 */
export function bucketGap(spanDays: number): MissedBlockBucket {
  if (spanDays <= 3) return "<=3d";
  if (spanDays <= 7) return "4-7d";
  if (spanDays <= 14) return "1-2w";
  return ">2w";
}

/**
 * Detect whether an athlete has missed a block of planned workouts.
 *
 * A planned workout is "missed" when it is `status='planned'`, has no live
 * match, and its scheduled day ended (athlete-local) at least `graceHours` ago.
 * The result reports the MOST RECENT contiguous run of missed days (so an old,
 * already-reflowed gap doesn't keep re-firing once newer training resumes), its
 * earliest date (a STABLE dedup anchor for repeated daily scans of the same
 * ongoing gap), the count, and the span bucket.
 */
export function detectMissedBlock(input: DetectMissedBlockInput): DetectMissedBlockResult {
  const { plannedWorkouts, matches, timezone, now, graceHours = DEFAULT_GRACE_HOURS } = input;

  const none: DetectMissedBlockResult = { missed: false, missedCount: 0, bucket: "<=3d" };

  // Athlete-local "today" → the cutoff day. A workout scheduled for day D ends
  // at the END of day D (local). It's "past grace" once now is >= end-of-D +
  // graceHours. graceHours/24 (ceil) full days back from local-today is the
  // newest scheduled_date that can already be past grace.
  const p = localPartsInTimezone(timezone, now);
  const todayKey = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  // End-of-day for a scheduled_date is the start of the NEXT day. Days-of-grace
  // measured in whole local days from end-of-today. A workout scheduled `g`
  // days ago (where g = ceil(graceHours/24)) is the most recent that is surely
  // >= graceHours past its end-of-day as of "now" within today.
  const graceDays = Math.ceil(graceHours / 24);
  // The latest scheduled_date that can be flagged is `graceDays` days before
  // today (end-of-(today - graceDays) is >= graceHours before end-of-today,
  // and now is somewhere within today, so it's also >= graceHours before now).
  const cutoffKey = addDaysUtc(todayKey, -graceDays);

  // Set of planned_workout_ids with a live match (the athlete did it).
  const matchedIds = new Set(matches.map((m) => m.planned_workout_id));

  // Missed = planned, unmatched, scheduled on/before the cutoff day.
  const missedDays = plannedWorkouts
    .filter(
      (w) =>
        w.status === "planned" &&
        !matchedIds.has(w.id) &&
        dayDiff(w.scheduled_date, cutoffKey) >= 0, // scheduled_date <= cutoff
    )
    .map((w) => w.scheduled_date)
    .sort();

  if (missedDays.length === 0) return none;

  // Collapse to distinct days, then find the MOST RECENT contiguous run.
  // Contiguous = consecutive missed days with no fully-completed/matched day
  // breaking them; we treat any non-missed scheduled day between two missed
  // days as a break (training resumed), so we segment purely on the missed-day
  // sequence's calendar gaps of > 1 day.
  const uniqueDays = [...new Set(missedDays)];
  // Walk from the end backward, extending while consecutive (<= 1 day apart).
  let endIdx = uniqueDays.length - 1;
  let startIdx = endIdx;
  while (startIdx > 0 && dayDiff(uniqueDays[startIdx - 1], uniqueDays[startIdx]) <= 1) {
    startIdx--;
  }
  const run = uniqueDays.slice(startIdx, endIdx + 1);
  const firstMissedDate = run[0];
  const lastMissedDate = run[run.length - 1];
  const spanDays = dayDiff(firstMissedDate, lastMissedDate) + 1; // inclusive

  // missedCount = distinct missed planned workouts within this run's date span
  // (multiple workouts on the same day count individually).
  const runSet = new Set(run);
  const missedCount = plannedWorkouts.filter(
    (w) =>
      w.status === "planned" &&
      !matchedIds.has(w.id) &&
      runSet.has(w.scheduled_date),
  ).length;

  return {
    missed: true,
    firstMissedDate,
    missedCount,
    bucket: bucketGap(spanDays),
  };
}

/** Add `n` days to a "YYYY-MM-DD" key, returning a new key. UTC-stable. */
function addDaysUtc(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
