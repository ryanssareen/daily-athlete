// Deterministic date-anchor correction for generated plans.
//
// The open-weight model (llama-3.3-70b) frequently ignores the "today" anchor in
// the prompt and emits scheduled_date values in a past era — observed in prod on
// 2026-06-24: a succeeded generation whose 7 workouts were dated 2024-01-01..07,
// ~2.5y in the past, so the plan never rendered on the calendar (issue #94).
//
// The relative STRUCTURE of such a plan is sound — correct day-spacing and
// week-over-week progression — only the absolute anchor is wrong. Rather than
// discard a structurally-valid plan (which would leave the athlete with nothing),
// we shift the whole plan forward so its first workout lands on or after `today`,
// preserving every relative relationship. This is the deterministic guarantee
// that a past-dated plan never persists, independent of how well the prompt holds.
//
// The shift is a WHOLE number of weeks. That keeps each workout on its original
// weekday and maps every ISO week onto an ISO week, so the downstream weekly
// ramp / CTL / TSB validation sees the same buckets it would have on the model's
// intended (mis-anchored) calendar — only the era changes, not the safety check.
//
// A correctly-anchored plan (earliest >= today, e.g. an event plan that already
// spans today->event) has shift 0 and passes through untouched: realignment can
// only repair an already-past-dated plan, never move a valid one. `event_date`
// is a real-world anchor and is deliberately left alone.

import type { GeneratedPlan } from "@da2/shared";

import { addDays, dayDiff } from "@/training-load";

export interface RealignResult {
  plan: GeneratedPlan;
  /** Days the plan was shifted forward (0 = already on/after today). */
  shiftedDays: number;
}

/**
 * Shift `plan` forward by whole weeks so its earliest scheduled_date is on or
 * after `today`. No-op when the plan already starts on/after today (returns the
 * same plan reference and shiftedDays 0).
 */
export function realignPlanToToday(
  plan: GeneratedPlan,
  today: string
): RealignResult {
  if (plan.workouts.length === 0) return { plan, shiftedDays: 0 };

  const earliest = plan.workouts.reduce(
    (min, w) => (w.scheduled_date < min ? w.scheduled_date : min),
    plan.workouts[0].scheduled_date
  );

  // dayDiff(earliest, today) = today - earliest; positive when earliest is past.
  const gap = dayDiff(earliest, today);
  if (gap <= 0) return { plan, shiftedDays: 0 };

  // Smallest whole-week shift that lands the earliest workout on/after today.
  const shiftedDays = Math.ceil(gap / 7) * 7;
  const workouts = plan.workouts.map((w) => ({
    ...w,
    scheduled_date: addDays(w.scheduled_date, shiftedDays),
  }));
  return { plan: { ...plan, workouts }, shiftedDays };
}
