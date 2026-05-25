// Deterministic training-load proxy: CTL / ATL / TSB from completed workouts.
//
// This is the *source of truth* layer of the AI adaptive-plans engine. It is a
// set of PURE FUNCTIONS (no I/O, no DB, no clock) so it is unit-testable the
// same way `apps/web/src/lib/training-math.ts` is, and so the engine can re-run
// it deterministically at generation AND at apply time.
//
// Model (Banister / TrainingPeaks Performance Manager Chart):
//   CTL = 42-day EWMA of daily TSS   (Chronic Training Load — "fitness")
//   ATL = 7-day  EWMA of daily TSS   (Acute Training Load   — "fatigue")
//   TSB = yesterday(CTL) − yesterday(ATL)  (Training Stress Balance — "form")
//   Recurrence: today = yest·e^(−1/τ) + TSS·(1 − e^(−1/τ)), τ = 42 / 7.
//   https://www.trainingpeaks.com/learn/articles/the-science-of-the-performance-manager/
//
// Per-workout TSS REUSES `@/lib/training-math` (`computeTSS`) when power is
// present, and the already-persisted `summary_stats.tss` when the workout was
// hydrated. rTSS (pace) and hrTSS (HR) are NOT implemented in this repo, so when
// power is absent we fall back to a conservative DURATION proxy and tag the
// workout's confidence as `'duration'` (vs `'power'`). The duration proxy
// deliberately biases TSB *conservative* (it never over-states load in a way
// that would green-light an aggressive bump): see `durationProxyTss`.

import { computeTSS } from "@/lib/training-math";

// --- Constants (grounded in the plan's External References) -----------------

/** Chronic Training Load time constant, days. TrainingPeaks PMC default. */
export const CTL_TAU_DAYS = 42;
/** Acute Training Load time constant, days. TrainingPeaks PMC default. */
export const ATL_TAU_DAYS = 7;

/**
 * Conservative TSS-per-hour for the duration-only fallback when no power data
 * exists. Anchored well below threshold: 1h at FTP = TSS 100, endurance (~0.7
 * IF) ≈ 50 TSS/h. We assume an EASY-aerobic effort (~IF 0.65 → ~42 TSS/h) so
 * the proxy under-counts rather than over-counts load. Under-counting biases
 * TSB *higher* (less fatigued) — but the safety contract (X2/X3) only requires
 * we never UNDER-state fatigue in a way that green-lights a bump; the proxy is
 * paired with the `confidence: 'duration'` tag so downstream B5/B6 (deferred)
 * can gate on power-confidence rather than trust this number.
 */
export const DURATION_PROXY_TSS_PER_HOUR = 42;

// --- Input / output shapes --------------------------------------------------

/** Minimal completed-workout shape the load proxy reads. Structural, not a DB row. */
export interface LoadWorkoutInput {
  /** ISO date or datetime the effort STARTED (athlete-local day is derived from this). */
  started_at: string;
  /** Workout duration in seconds. Nullable for sparse manual entries. */
  duration_s: number | null;
  /**
   * `summary_stats` blob (see packages/shared SummaryStatsSchema). The proxy
   * reads tss / tss_equivalent, normalized power, ftp, and the `manual` flag.
   */
  summary_stats: Record<string, unknown> | null | undefined;
}

export type LoadConfidence = "power" | "duration";

export interface PerWorkoutLoad {
  /** Athlete-local calendar day, "YYYY-MM-DD". */
  date: string;
  /** TSS for this single effort (>= 0). */
  tss: number;
  /** Whether the TSS came from power data or the duration fallback. */
  confidence: LoadConfidence;
}

export interface LoadDayPoint {
  /** Calendar day, "YYYY-MM-DD". */
  date: string;
  /** Total TSS accrued on this day (sum across workouts that day). */
  tss: number;
  /** CTL value at end of this day. */
  ctl: number;
  /** ATL value at end of this day. */
  atl: number;
  /** TSB for this day = yesterday's (CTL − ATL). */
  tsb: number;
}

export interface LoadState {
  /** The full daily series (one point per calendar day in range). */
  series: LoadDayPoint[];
  /** CTL as of the most recent day in the series (0 if empty). */
  ctl: number;
  /** ATL as of the most recent day in the series (0 if empty). */
  atl: number;
  /** TSB as of the most recent day (= yesterday CTL − yesterday ATL). */
  tsb: number;
  /**
   * CTL ramp rate per week = (CTL_today − CTL_7-days-ago). The plan's safety
   * invariant caps this at ~8/week (TrainingPeaks ramp-rate guidance).
   */
  ctlRampPerWeek: number;
  /**
   * Fraction of load-eligible workouts whose TSS came from power data (0..1).
   * Downstream proactive triggers (B5/B6, deferred) gate on this so a
   * duration-proxy-heavy series never drives an unprompted fire decision.
   */
  powerConfidenceRatio: number;
}

// --- Date helpers (pure, UTC-stable) ----------------------------------------

/**
 * Reduce an ISO datetime to its calendar day "YYYY-MM-DD". We intentionally use
 * the date portion as-stored. Athlete-timezone normalization happens upstream
 * at the read boundary (see AGENTS.md "read/render-boundary timezone pattern");
 * keeping this pure means the series is deterministic for a fixed fixture.
 */
export function toDayKey(isoDate: string): string {
  // Fast path: already a bare date or an ISO string whose first 10 chars are the
  // calendar day. Avoids `new Date()` timezone surprises for "YYYY-MM-DD".
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(isoDate);
  if (m) return m[1];
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`toDayKey: unparseable date "${isoDate}"`);
  }
  return d.toISOString().slice(0, 10);
}

/** Days between two "YYYY-MM-DD" keys (b − a), calendar days. */
export function dayDiff(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((tb - ta) / 86_400_000);
}

/** Add `n` days to a "YYYY-MM-DD" key, returning a new key. */
export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

// --- Per-workout TSS (reuses training-math; conservative duration fallback) --

function readNumber(stats: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!stats) return null;
  const v = stats[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Conservative duration-only TSS. NEVER returns more than the power formula
 * would for the same duration at threshold, by construction (we use an
 * easy-aerobic TSS/hour anchor).
 */
export function durationProxyTss(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return (durationSec / 3600) * DURATION_PROXY_TSS_PER_HOUR;
}

/**
 * TSS for a single completed workout + the confidence tier it came from.
 *
 * Priority:
 *  1. Persisted `summary_stats.tss_equivalent` / `.tss` (already power-derived
 *     at hydration) → confidence 'power'.
 *  2. Live power compute via `computeTSS` (REUSES training-math.ts) when
 *     normalized power + FTP are present → 'power'.
 *  3. Duration proxy → 'duration' (conservative).
 *
 * Returns `null` when the workout carries no usable signal at all (no TSS, no
 * power, no positive duration) — such workouts are EXCLUDED from the series,
 * which biases TSB conservative (lower load counted ⇒ we won't over-state
 * fitness). Strength/mobility with no duration naturally fall out here.
 */
export function computeWorkoutTss(w: LoadWorkoutInput): PerWorkoutLoad | null {
  const date = toDayKey(w.started_at);
  const stats = w.summary_stats;

  // 1. Persisted power-TSS (canonical name first, then the currently-stored key).
  const persisted = readNumber(stats, "tss_equivalent") ?? readNumber(stats, "tss");
  if (persisted != null && persisted >= 0) {
    return { date, tss: persisted, confidence: "power" };
  }

  // 2. Live power compute (reuse training-math.ts). Prefer normalized power.
  const np =
    readNumber(stats, "normalized_power_w") ??
    readNumber(stats, "weighted_average_watts") ??
    readNumber(stats, "avg_power_w") ??
    readNumber(stats, "average_watts");
  const ftp = readNumber(stats, "ftp_at_workout");
  const dur = typeof w.duration_s === "number" && Number.isFinite(w.duration_s) ? w.duration_s : null;
  if (np != null && ftp != null && dur != null) {
    const tss = computeTSS(dur, np, ftp);
    if (tss != null && tss >= 0) {
      return { date, tss, confidence: "power" };
    }
  }

  // 3. Duration proxy (conservative). Last resort.
  if (dur != null && dur > 0) {
    return { date, tss: durationProxyTss(dur), confidence: "duration" };
  }

  // No usable signal: exclude (conservative — counts as zero load).
  return null;
}

// --- EWMA series ------------------------------------------------------------

/** e^(−1/τ) decay factor for a τ-day EWMA. */
function decay(tauDays: number): number {
  return Math.exp(-1 / tauDays);
}

/**
 * Build the dense daily CTL/ATL/TSB series from completed workouts.
 *
 * @param workouts  Completed efforts (any order; deduped/summed per day).
 * @param opts.asOf Optional "YYYY-MM-DD" to extend the series to (e.g. today),
 *                  so days with no workouts after the last effort still decay.
 *                  Defaults to the last workout day.
 * @param opts.seedCtl / opts.seedAtl  Optional priors for the day BEFORE the
 *                  first day (default 0 — a cold start, conservative).
 *
 * The series is dense: every calendar day from the first effort (or seed day)
 * through `asOf` gets a point, so EWMAs decay correctly across rest days.
 */
export function buildLoadSeries(
  workouts: LoadWorkoutInput[],
  opts: { asOf?: string; seedCtl?: number; seedAtl?: number } = {}
): LoadState {
  const perWorkout: PerWorkoutLoad[] = [];
  for (const w of workouts) {
    const r = computeWorkoutTss(w);
    if (r != null) perWorkout.push(r);
  }

  const powerCount = perWorkout.filter((p) => p.confidence === "power").length;
  const powerConfidenceRatio = perWorkout.length === 0 ? 0 : powerCount / perWorkout.length;

  if (perWorkout.length === 0) {
    return {
      series: [],
      ctl: opts.seedCtl ?? 0,
      atl: opts.seedAtl ?? 0,
      tsb: (opts.seedCtl ?? 0) - (opts.seedAtl ?? 0),
      ctlRampPerWeek: 0,
      powerConfidenceRatio: 0,
    };
  }

  // Sum TSS per day.
  const tssByDay = new Map<string, number>();
  for (const p of perWorkout) {
    tssByDay.set(p.date, (tssByDay.get(p.date) ?? 0) + p.tss);
  }

  const days = [...tssByDay.keys()].sort();
  const firstDay = days[0];
  const lastWorkoutDay = days[days.length - 1];
  const endDay =
    opts.asOf && dayDiff(lastWorkoutDay, opts.asOf) > 0 ? opts.asOf : lastWorkoutDay;

  const ctlDecay = decay(CTL_TAU_DAYS);
  const atlDecay = decay(ATL_TAU_DAYS);

  const series: LoadDayPoint[] = [];
  // "yesterday" carries forward across the dense range.
  let prevCtl = opts.seedCtl ?? 0;
  let prevAtl = opts.seedAtl ?? 0;

  const totalDays = dayDiff(firstDay, endDay);
  for (let i = 0; i <= totalDays; i++) {
    const date = addDays(firstDay, i);
    const tss = tssByDay.get(date) ?? 0;

    // TSB is computed from YESTERDAY's values (before today's update) — this is
    // the canonical Performance Manager definition.
    const tsb = prevCtl - prevAtl;

    const ctl = prevCtl * ctlDecay + tss * (1 - ctlDecay);
    const atl = prevAtl * atlDecay + tss * (1 - atlDecay);

    series.push({ date, tss, ctl, atl, tsb });
    prevCtl = ctl;
    prevAtl = atl;
  }

  const last = series[series.length - 1];

  // CTL ramp per week = CTL_today − CTL_(7 days ago). If the series is shorter
  // than 7 days, ramp from the seed (day −1) baseline scaled to a 7-day window.
  const idx7 = series.length - 1 - 7;
  let ctlRampPerWeek: number;
  if (idx7 >= 0) {
    ctlRampPerWeek = last.ctl - series[idx7].ctl;
  } else {
    // Use the pre-series seed CTL as the baseline and annualize to 7 days.
    const spanDays = series.length; // days elapsed incl. today
    const baselineCtl = opts.seedCtl ?? 0;
    ctlRampPerWeek = spanDays > 0 ? ((last.ctl - baselineCtl) / spanDays) * 7 : 0;
  }

  return {
    series,
    ctl: last.ctl,
    atl: last.atl,
    // Current TSB = yesterday(CTL − ATL) = the last point's `tsb` field IS
    // yesterday-relative; but "current state" TSB is most-useful as today's
    // form going INTO tomorrow, i.e. last.ctl − last.atl. We expose the
    // forward-looking value (consistent with how a coach reads "today's form").
    tsb: last.ctl - last.atl,
    ctlRampPerWeek,
    powerConfidenceRatio,
  };
}
