// Whole-plan safety validator for AI-generated plans.
//
// This is NET-NEW forward-simulation math — NOT a reuse of the point-in-time
// diff validator (apps/web/src/training-load/invariants.ts validateOps). Two
// document-review P0 findings established why a reuse is wrong:
//   - validateOps' weekly-ramp check is gated `if (original > 0)`, so against an
//     empty baseline (a from-scratch plan) it silently never fires; and
//   - projectLoadWithAddedTss injects the WHOLE plan's TSS as a single same-day
//     spike, which false-refuses every multi-week plan.
//
// Instead we project the plan forward day-by-day by feeding its workouts to
// buildLoadSeries as synthetic efforts (seeded from the athlete's current load),
// then scan the projected CTL/ATL/TSB trajectory plus intra-plan weekly volume
// ramp. We share only the THRESHOLD CONSTANTS with the diff validator so "safe"
// means the same magnitudes at generation, eval, and apply time — the check
// shape differs (trajectory vs diff), the thresholds do not.

import type { GeneratedPlan } from "@da2/shared";

import {
  addDays,
  buildLoadSeries,
  CTL_RAMP_CAP_PER_WEEK,
  isoWeekKey,
  type LoadWorkoutInput,
  TAPER_WINDOW_DAYS,
  TSB_FLOOR,
  WEEKLY_VOLUME_RAMP_CAP,
} from "@/training-load";

export type PlanViolationCode =
  | "volume_ramp"
  | "ctl_ramp"
  | "tsb_floor"
  | "taper_window";

export interface PlanViolation {
  code: PlanViolationCode;
  /** Human-readable; fed back to the model verbatim on regeneration. */
  detail: string;
}

export interface ValidateGeneratedPlanResult {
  valid: boolean;
  violations: PlanViolation[];
}

export interface PlanLoadContext {
  /** Athlete's current CTL/ATL (from buildLoadSeries over their completed
   * history; 0/0 cold-start for a new athlete — conservative). */
  seedCtl: number;
  seedAtl: number;
  /** Recent weekly TSS the FIRST plan week is compared against, so a plan that
   * opens far above the athlete's current volume is caught. Omit for a true
   * cold start (then the first week has no ramp baseline). */
  recentWeeklyTss?: number;
}

// How many prior weeks form the ramp baseline. Using the rolling MAX over a 3:1
// build/deload cycle means returning to the pre-deload peak after a recovery
// week is NOT mis-flagged as a ramp, while a genuine jump above the recent peak
// still is.
const RAMP_BASELINE_WEEKS = 3;
const EPS = 1e-6;

interface WeekTotal {
  total: number;
  firstDate: string;
}

function round(n: number): number {
  return Math.round(n);
}

/** Group planned workouts into ordered ISO-week TSS totals. */
function weeklyTotals(plan: GeneratedPlan): WeekTotal[] {
  const byWeek = new Map<string, WeekTotal>();
  for (const w of plan.workouts) {
    const key = isoWeekKey(w.scheduled_date);
    const cur = byWeek.get(key);
    if (cur) {
      cur.total += w.planned_load;
      if (w.scheduled_date < cur.firstDate) cur.firstDate = w.scheduled_date;
    } else {
      byWeek.set(key, { total: w.planned_load, firstDate: w.scheduled_date });
    }
  }
  return [...byWeek.values()].sort((a, b) =>
    a.firstDate < b.firstDate ? -1 : a.firstDate > b.firstDate ? 1 : 0
  );
}

export function validateGeneratedPlan(
  plan: GeneratedPlan,
  ctx: PlanLoadContext
): ValidateGeneratedPlanResult {
  const violations: PlanViolation[] = [];
  if (plan.workouts.length === 0) return { valid: true, violations };

  const weeks = weeklyTotals(plan);

  // --- 1. Intra-plan weekly volume ramp -----------------------------------
  // Each week vs the MAX of the prior few weeks (or the athlete's recent
  // baseline for week 1). Catches the empty-baseline P0: a from-scratch plan's
  // own week-over-week jumps are checked, not skipped.
  for (let i = 0; i < weeks.length; i++) {
    const prior = weeks
      .slice(Math.max(0, i - RAMP_BASELINE_WEEKS), i)
      .map((w) => w.total);
    const baseline = prior.length
      ? Math.max(...prior)
      : (ctx.recentWeeklyTss ?? 0);
    if (baseline > 0 && weeks[i].total > baseline * (1 + WEEKLY_VOLUME_RAMP_CAP) + EPS) {
      violations.push({
        code: "volume_ramp",
        detail: `week of ${weeks[i].firstDate} totals ${round(weeks[i].total)} TSS, more than ${Math.round(
          WEEKLY_VOLUME_RAMP_CAP * 100
        )}% above the recent ${round(baseline)} TSS baseline`,
      });
      break;
    }
  }

  // --- Forward-simulate the load trajectory -------------------------------
  const inputs: LoadWorkoutInput[] = plan.workouts.map((w) => ({
    started_at: w.scheduled_date,
    duration_s: w.structure.duration_s,
    summary_stats: { tss: w.planned_load },
  }));
  const lastDay = weeks[weeks.length - 1]
    ? plan.workouts.reduce((max, w) => (w.scheduled_date > max ? w.scheduled_date : max), plan.workouts[0].scheduled_date)
    : undefined;
  const projected = buildLoadSeries(inputs, {
    asOf: lastDay,
    seedCtl: ctx.seedCtl,
    seedAtl: ctx.seedAtl,
  });

  // --- 2. CTL ramp across any 7-day window --------------------------------
  let maxRamp = 0;
  let rampDate = "";
  for (let i = 7; i < projected.series.length; i++) {
    const r = projected.series[i].ctl - projected.series[i - 7].ctl;
    if (r > maxRamp) {
      maxRamp = r;
      rampDate = projected.series[i].date;
    }
  }
  if (maxRamp > CTL_RAMP_CAP_PER_WEEK + EPS) {
    violations.push({
      code: "ctl_ramp",
      detail: `projected CTL climbs ${round(maxRamp)}/week by ${rampDate}, above the ${CTL_RAMP_CAP_PER_WEEK}/week cap`,
    });
  }

  // --- 3. Projected TSB floor ---------------------------------------------
  let minTsb = Infinity;
  let tsbDate = "";
  for (const p of projected.series) {
    if (p.tsb < minTsb) {
      minTsb = p.tsb;
      tsbDate = p.date;
    }
  }
  if (projected.series.length > 0 && minTsb < TSB_FLOOR - EPS) {
    violations.push({
      code: "tsb_floor",
      detail: `projected TSB dips to ${round(minTsb)} on ${tsbDate}, below the ${TSB_FLOOR} floor`,
    });
  }

  // --- 4. Taper window (only when there is an event) ----------------------
  if (plan.event_date) {
    const taperStart = addDays(plan.event_date, -TAPER_WINDOW_DAYS);
    const preTaper = weeks.filter((w) => w.firstDate < taperStart);
    const taper = weeks.filter(
      (w) => w.firstDate >= taperStart && w.firstDate <= plan.event_date!
    );
    if (preTaper.length > 0 && taper.length > 0) {
      const peak = Math.max(...preTaper.map((w) => w.total));
      const maxTaper = Math.max(...taper.map((w) => w.total));
      if (maxTaper >= peak - EPS) {
        violations.push({
          code: "taper_window",
          detail: `taper-window weekly load (${round(maxTaper)} TSS) is not reduced below the ${round(peak)} TSS peak before the event`,
        });
      }
    }
  }

  return { valid: violations.length === 0, violations };
}
