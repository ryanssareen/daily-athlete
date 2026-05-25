// Deterministic safety-invariant validator for AI-proposed plan edits.
//
// `validateOps(plan, ops, loadState)` is a PURE FUNCTION. It is the guardrail
// the engine runs at GENERATION (drop unsafe ops before the athlete sees them)
// AND re-runs at APPLY against current load (Unit 6) — "no invariant-breaching
// op reaches an applied state" is enforced end-to-end, not just at propose time.
//
// It NEVER mutates plan state; it partitions the proposed ops into kept + dropped
// (each drop carries a machine-readable reason). The LLM proposes within these
// bounds; this layer is authoritative.
//
// Constants are grounded in the plan's External References (TrainingPeaks /
// Friel / Couzens):
//   - Weekly volume ramp soft cap ~10%/week.
//   - CTL ramp 3–5/week sustainable; >8/week unsafe.
//   - TSB floor: unscheduled-deload territory below ≈−30.
//   - Never schedule inside the taper window or past `event_date`.
//   - Coach-edited (or recently-edited NULL-attribution) rows are protected.

import type { EditOp, Sport } from "@da2/shared";

import {
  buildLoadSeries,
  dayDiff,
  durationProxyTss,
  toDayKey,
  type LoadState,
  type LoadWorkoutInput,
} from "./load-series";

// --- Tunable invariant constants --------------------------------------------

/** Weekly training-volume increase soft cap (fraction). ~10%/week (Friel). */
export const WEEKLY_VOLUME_RAMP_CAP = 0.1;
/** CTL ramp hard ceiling per week. >8/week is unsafe (TrainingPeaks). */
export const CTL_RAMP_CAP_PER_WEEK = 8;
/** TSB floor: below this is unscheduled-deload territory (Couzens). */
export const TSB_FLOOR = -30;
/**
 * Taper window before the event during which no new/heavier load may be
 * scheduled (days). 14 days is the canonical 2-week taper anchor; the engine
 * may tune per-distance later, but the *guardrail* uses a conservative fixed
 * window. Friel: "never cram the taper."
 */
export const TAPER_WINDOW_DAYS = 14;
/**
 * A row edited within this many days with `edited_by_kind IS NULL` is treated as
 * conservatively coach-protected (until Unit 2's attribution backfill makes the
 * signal authoritative). 14 days = roughly a planning cycle.
 */
export const RECENT_EDIT_PROTECTION_DAYS = 14;

// --- Local structural types --------------------------------------------------
//
// `ValidatableOp` is the FLATTENED view the load-math validator consumes: it
// only needs an op's effective target date and its resulting volume/load, not
// the full shape of the diff. The canonical diff type is the shared `EditOp`
// discriminated union in `packages/shared/src/edit-op.ts`; the engine produces
// `EditOp[]` and converts to `ValidatableOp[]` for validation via the
// `toValidatableOp` adapter below, so the engine and validator share ONE op
// type at the boundary (the adapter flattens the union into the math view).

export type EditOpKind = "move" | "modify" | "skip" | "insert" | "delete";

/** Minimal structural op the validator depends on. */
export interface ValidatableOp {
  /** Stable id so callers can map dropped → original. */
  op_id: string;
  kind: EditOpKind;
  /** Target planned-workout id (null for `insert`, which has no pre-existing row). */
  workout_id: string | null;
  /**
   * The date the workout will land on after the op. For `move`/`insert` this is
   * the new date; for `modify`/`skip`/`delete` it's the existing row's date.
   * "YYYY-MM-DD".
   */
  target_date: string;
  /** New duration in seconds, when the op sets/changes load. Null = unchanged. */
  duration_s?: number | null;
  /** New TSS-equivalent load, when known. Null = derive from duration. */
  load?: number | null;
  /** Sport (for completeness; not currently gated). */
  sport?: Sport;
  /** LLM-provided human reason (untrusted; not used for gating). */
  reason?: string;
}

/** Minimal structural plan context. */
export interface ValidatablePlan {
  /** Event date "YYYY-MM-DD", or null for a no-date plan. */
  event_date: string | null;
}

/**
 * Minimal structural view of an existing planned-workout row the validator reads
 * for the current weekly-volume baseline and coach-protection check.
 */
export interface ValidatablePlannedWorkout {
  id: string;
  /** "YYYY-MM-DD". */
  scheduled_date: string;
  /** Current duration in seconds (the volume unit), nullable. */
  duration_s: number | null;
  /** Current TSS-equivalent load, nullable (falls back to duration proxy). */
  load: number | null;
  /** "planned" | "completed" | "skipped" | "moved". */
  status: string;
  /** Attribution: who last edited. NULL = unknown (conservatively protected). */
  edited_by_kind: "athlete" | "coach" | "ai_review" | null;
  /** When last edited, ISO datetime or null. */
  edited_at: string | null;
}

export type DropReason =
  | "volume_ramp"
  | "ctl_ramp"
  | "tsb_floor"
  | "taper_window"
  | "past_event"
  | "coach_protected";

export interface DroppedOp {
  op: ValidatableOp;
  reason: DropReason;
}

export interface ValidateResult {
  valid: ValidatableOp[];
  dropped: DroppedOp[];
}

export interface ValidateContext {
  /** Existing planned workouts (the volume baseline + coach-protection source). */
  plannedWorkouts: ValidatablePlannedWorkout[];
  /** Current load state (CTL/ATL/TSB), e.g. from `buildLoadSeries`. */
  loadState: LoadState;
  /**
   * Completed workouts feeding the load proxy, so projected-TSB / CTL-ramp can
   * be recomputed WITH the ops' added load. Optional; when omitted, projection
   * uses `loadState` deltas only.
   */
  completedWorkouts?: LoadWorkoutInput[];
  /** "Today" as "YYYY-MM-DD" — the reference for recent-edit + ramp windows. */
  asOf: string;
}

// --- Helpers ----------------------------------------------------------------

/** ISO-week key "YYYY-Www" for grouping weekly volume. Pure, UTC-stable. */
export function isoWeekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  // ISO week: Thursday-anchored.
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Volume (seconds) a row contributes; 0 if not load-bearing. */
function rowVolumeSeconds(w: { duration_s: number | null }): number {
  return typeof w.duration_s === "number" && Number.isFinite(w.duration_s) && w.duration_s > 0
    ? w.duration_s
    : 0;
}

/** Op's resulting volume (seconds): explicit duration, else 0 for skip/delete. */
function opVolumeSeconds(op: ValidatableOp): number {
  if (op.kind === "skip" || op.kind === "delete") return 0;
  return typeof op.duration_s === "number" && Number.isFinite(op.duration_s) && op.duration_s > 0
    ? op.duration_s
    : 0;
}

/** Op's TSS-equivalent: explicit load, else duration proxy, else 0. */
function opTss(op: ValidatableOp): number {
  if (op.kind === "skip" || op.kind === "delete") return 0;
  if (typeof op.load === "number" && Number.isFinite(op.load) && op.load >= 0) return op.load;
  const vol = opVolumeSeconds(op);
  return vol > 0 ? durationProxyTss(vol) : 0;
}

// --- The validator ----------------------------------------------------------

/**
 * Partition proposed ops into kept + dropped-with-reason. Drop precedence
 * (first matching reason wins) is coach-protection → past-event → taper →
 * volume-ramp → ctl-ramp → tsb-floor. Coach-protection is checked first because
 * it's a hard "the LLM may not touch this row" rule independent of load math.
 *
 * `event_date`-dependent invariants (taper, past-event) are NO-OPS when
 * `plan.event_date` is null.
 */
export function validateOps(
  plan: ValidatablePlan,
  ops: ValidatableOp[],
  ctx: ValidateContext
): ValidateResult {
  const valid: ValidatableOp[] = [];
  const dropped: DroppedOp[] = [];

  const byId = new Map<string, ValidatablePlannedWorkout>();
  for (const w of ctx.plannedWorkouts) byId.set(w.id, w);

  // Baseline weekly volume (seconds) from EXISTING non-deleted, non-completed
  // planned workouts. We only ramp-cap weeks the ops actually touch.
  const baselineWeekVolume = new Map<string, number>();
  for (const w of ctx.plannedWorkouts) {
    if (w.status === "completed" || w.status === "skipped" || w.status === "moved") continue;
    const key = isoWeekKey(w.scheduled_date);
    baselineWeekVolume.set(key, (baselineWeekVolume.get(key) ?? 0) + rowVolumeSeconds(w));
  }

  // Accumulate accepted ops' projected volume per week so a batch of small bumps
  // can't sneak past the cap individually.
  const projectedWeekVolume = new Map<string, number>(baselineWeekVolume);

  // Accumulate accepted ops' added TSS for the projected CTL-ramp / TSB checks.
  let acceptedAddedTss = 0;

  for (const op of ops) {
    const reason = classifyDrop(
      op,
      plan,
      ctx,
      byId,
      baselineWeekVolume,
      projectedWeekVolume,
      acceptedAddedTss
    );
    if (reason != null) {
      dropped.push({ op, reason });
      continue;
    }
    // Keep it — and fold its effect into the running projections so later ops in
    // the same batch are validated against the post-accept state.
    const week = isoWeekKey(op.target_date);
    const target = op.workout_id ? byId.get(op.workout_id) : undefined;
    const prevVol = target ? rowVolumeSeconds(target) : 0;
    const delta = opVolumeSeconds(op) - (op.kind === "move" || op.kind === "modify" ? prevVol : 0);
    projectedWeekVolume.set(week, (projectedWeekVolume.get(week) ?? 0) + delta);
    // A `move` relocates existing load to another day -- net-zero added TSS, so
    // like `modify` it subtracts the target's old TSS (only `insert` adds new load).
    acceptedAddedTss +=
      opTss(op) - (target && (op.kind === "modify" || op.kind === "move") ? opTssOfRow(target) : 0);
    valid.push(op);
  }

  return { valid, dropped };
}

/** Existing row's TSS-equivalent for delta math. */
function opTssOfRow(w: ValidatablePlannedWorkout): number {
  if (typeof w.load === "number" && Number.isFinite(w.load) && w.load >= 0) return w.load;
  const vol = rowVolumeSeconds(w);
  return vol > 0 ? durationProxyTss(vol) : 0;
}

/**
 * Return the first invariant a single op breaches, or null if it's safe given
 * the running projections.
 */
function classifyDrop(
  op: ValidatableOp,
  plan: ValidatablePlan,
  ctx: ValidateContext,
  byId: Map<string, ValidatablePlannedWorkout>,
  /** Original per-week baseline volume (the ramp cap is measured against THIS). */
  baselineWeekVolume: Map<string, number>,
  /** Running per-week volume incl. already-accepted ops in this batch. */
  projectedWeekVolume: Map<string, number>,
  acceptedAddedTss: number
): DropReason | null {
  // 1. Coach-protection (hard rule, load-independent).
  if (op.workout_id) {
    const target = byId.get(op.workout_id);
    if (target && isCoachProtected(target, ctx.asOf)) return "coach_protected";
  }

  // 2. Event-relative invariants — NO-OP when event_date is null.
  if (plan.event_date != null) {
    const eventDay = toDayKey(plan.event_date);
    const targetDay = toDayKey(op.target_date);

    // 2a. Past the event: nothing may be scheduled/landed after the event.
    // Applies only to ops that PLACE a workout on a day (move/insert/modify),
    // not to skip/delete (removing load after the event is harmless).
    if (op.kind !== "skip" && op.kind !== "delete" && dayDiff(eventDay, targetDay) > 0) {
      return "past_event";
    }

    // 2b. Taper window: no NEW or HEAVIER load inside [event − taper, event].
    // skip/delete (load reduction) are allowed in the taper.
    if (op.kind !== "skip" && op.kind !== "delete") {
      const daysToEvent = dayDiff(targetDay, eventDay);
      const inTaper = daysToEvent >= 0 && daysToEvent <= TAPER_WINDOW_DAYS;
      if (inTaper && addsOrIncreasesLoad(op, byId)) return "taper_window";
    }
  }

  // 3. Weekly volume ramp cap (~10%). Measured against the ORIGINAL weekly
  // baseline, with the running projected total (this op + already-accepted ops
  // in the batch) so cumulative small bumps can't sneak past one-at-a-time.
  if (op.kind !== "skip" && op.kind !== "delete") {
    const week = isoWeekKey(op.target_date);
    const original = baselineWeekVolume.get(week) ?? 0;
    const running = projectedWeekVolume.get(week) ?? 0;
    const target = op.workout_id ? byId.get(op.workout_id) : undefined;
    const prevVol = target ? rowVolumeSeconds(target) : 0;
    const delta = opVolumeSeconds(op) - (op.kind === "move" || op.kind === "modify" ? prevVol : 0);
    const projectedTotal = running + delta;
    // Only flag INCREASES beyond the cap. A cut/deload always passes here.
    if (original > 0 && projectedTotal > original * (1 + WEEKLY_VOLUME_RAMP_CAP) + 1e-6) {
      return "volume_ramp";
    }
  }

  // 4 + 5. Load-trend invariants (projected CTL ramp + projected TSB floor).
  const addedTss = acceptedAddedTss + opTss(op);
  if (addedTss > 0) {
    const projected = projectLoadWithAddedTss(ctx, addedTss);
    if (projected.ctlRampPerWeek > CTL_RAMP_CAP_PER_WEEK + 1e-6) return "ctl_ramp";
    if (projected.tsb < TSB_FLOOR - 1e-6) return "tsb_floor";
  }

  return null;
}

/** A row counts as coach-protected when coach-attributed OR recently-edited-but-unattributed. */
function isCoachProtected(w: ValidatablePlannedWorkout, asOf: string): boolean {
  if (w.edited_by_kind === "coach") return true;
  if (w.edited_by_kind === null && w.edited_at != null) {
    const editedDay = toDayKey(w.edited_at);
    const ageDays = dayDiff(editedDay, asOf);
    // Recently edited (within the window) with unknown attribution → protect.
    if (ageDays >= 0 && ageDays <= RECENT_EDIT_PROTECTION_DAYS) return true;
  }
  return false;
}

/** Does the op add a workout or increase an existing one's load? */
function addsOrIncreasesLoad(
  op: ValidatableOp,
  byId: Map<string, ValidatablePlannedWorkout>
): boolean {
  if (op.kind === "insert") return opTss(op) > 0;
  if (op.kind === "move") return true; // moving a workout INTO the taper adds load there
  if (op.kind === "modify") {
    const target = op.workout_id ? byId.get(op.workout_id) : undefined;
    if (!target) return opTss(op) > 0;
    return opTss(op) > opTssOfRow(target) + 1e-6;
  }
  return false;
}

/**
 * Recompute the projected CTL-ramp + current TSB as if `addedTss` extra load
 * landed on the most recent day. Uses the real series when completed workouts
 * are supplied (most accurate); otherwise approximates from `loadState`.
 */
function projectLoadWithAddedTss(
  ctx: ValidateContext,
  addedTss: number
): { ctlRampPerWeek: number; tsb: number } {
  if (ctx.completedWorkouts && ctx.completedWorkouts.length > 0) {
    const augmented: LoadWorkoutInput[] = [
      ...ctx.completedWorkouts,
      {
        started_at: ctx.asOf,
        duration_s: null,
        // Inject the added TSS directly as a power-confident synthetic effort
        // so it flows through the same EWMA recurrence.
        summary_stats: { tss: addedTss },
      },
    ];
    const projected = buildLoadSeries(augmented, { asOf: ctx.asOf });
    return { ctlRampPerWeek: projected.ctlRampPerWeek, tsb: projected.tsb };
  }

  // Fallback approximation: a same-day TSS bump raises today's ATL fast and CTL
  // slowly, lowering TSB. Use the EWMA weights for a one-day injection.
  const atlWeight = 1 - Math.exp(-1 / 7);
  const ctlWeight = 1 - Math.exp(-1 / 42);
  const projAtl = ctx.loadState.atl + addedTss * atlWeight;
  const projCtl = ctx.loadState.ctl + addedTss * ctlWeight;
  return {
    ctlRampPerWeek: ctx.loadState.ctlRampPerWeek + addedTss * ctlWeight,
    tsb: projCtl - projAtl,
  };
}

// --- Shared EditOp adapter ---------------------------------------------------

/**
 * The current calendar date of a targeted planned-workout row, by id. The
 * adapter needs this for `modify`/`skip`/`delete` ops, which carry no date of
 * their own (the date is the existing row's `scheduled_date`).
 */
export type TargetDateLookup = (workoutId: string) => string | undefined;

/**
 * Flatten a canonical shared `EditOp` (discriminated union, nested
 * `changes`/`structure`) into the `ValidatableOp` view the load-math validator
 * consumes. This is the single conversion point so the engine and the validator
 * share one op type at the boundary.
 *
 * @param op           A parsed, schema-valid shared EditOp.
 * @param lookupDate   Resolves an existing row's date for ops without their own
 *                     date (`modify`/`skip`/`delete`).
 */
export function toValidatableOp(op: EditOp, lookupDate: TargetDateLookup): ValidatableOp {
  switch (op.kind) {
    case "move":
      return {
        op_id: op.op_id,
        kind: "move",
        workout_id: op.workout_id,
        target_date: op.to_date,
        reason: op.reason,
      };
    case "modify":
      return {
        op_id: op.op_id,
        kind: "modify",
        workout_id: op.workout_id,
        // modify carries no date of its own — it edits the existing row in place.
        target_date: lookupDate(op.workout_id) ?? "",
        duration_s: op.changes.duration_s ?? null,
        load: op.changes.load ?? null,
        reason: op.reason,
      };
    case "skip":
      return {
        op_id: op.op_id,
        kind: "skip",
        workout_id: op.workout_id,
        target_date: lookupDate(op.workout_id) ?? "",
        reason: op.reason,
      };
    case "delete":
      return {
        op_id: op.op_id,
        kind: "delete",
        workout_id: op.workout_id,
        target_date: lookupDate(op.workout_id) ?? "",
        reason: op.reason,
      };
    case "insert":
      return {
        op_id: op.op_id,
        kind: "insert",
        workout_id: null,
        target_date: op.on_date,
        duration_s: op.structure.duration_s ?? null,
        load: op.structure.load ?? null,
        sport: op.sport,
        reason: op.reason,
      };
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

/**
 * Convenience: validate a list of shared `EditOp`s. Builds the date lookup from
 * the planned-workout rows in `ctx`, flattens each op via `toValidatableOp`, runs
 * `validateOps`, then maps the kept/dropped `ValidatableOp`s back to their source
 * `EditOp`s by `op_id` so the engine works in shared-EditOp terms throughout.
 */
export function validateEditOps(
  plan: ValidatablePlan,
  ops: EditOp[],
  ctx: ValidateContext
): { valid: EditOp[]; dropped: { op: EditOp; reason: DropReason }[] } {
  const byOpId = new Map<string, EditOp>();
  for (const op of ops) byOpId.set(op.op_id, op);

  const dateById = new Map<string, string>();
  for (const w of ctx.plannedWorkouts) dateById.set(w.id, w.scheduled_date);
  const lookupDate: TargetDateLookup = (id) => dateById.get(id);

  const flat = ops.map((op) => toValidatableOp(op, lookupDate));
  const res = validateOps(plan, flat, ctx);

  return {
    valid: res.valid.map((v) => byOpId.get(v.op_id)).filter((x): x is EditOp => x != null),
    dropped: res.dropped
      .map((d) => {
        const src = byOpId.get(d.op.op_id);
        return src ? { op: src, reason: d.reason } : null;
      })
      .filter((x): x is { op: EditOp; reason: DropReason } => x != null),
  };
}
