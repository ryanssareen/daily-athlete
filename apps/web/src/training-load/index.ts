// Deterministic training-load + guardrail module (AI adaptive-plans engine,
// Unit 4). The source-of-truth layer: a CTL/ATL/TSB load proxy computed from
// completed workouts, plus an invariant validator that drops unsafe edit ops.
// All pure functions — re-run at generation AND at apply.

export {
  // Constants
  CTL_TAU_DAYS,
  ATL_TAU_DAYS,
  DURATION_PROXY_TSS_PER_HOUR,
  // Date helpers
  toDayKey,
  dayDiff,
  addDays,
  // Per-workout + series
  durationProxyTss,
  computeWorkoutTss,
  buildLoadSeries,
  // Types
  type LoadConfidence,
  type LoadWorkoutInput,
  type PerWorkoutLoad,
  type LoadDayPoint,
  type LoadState,
} from "./load-series";

export {
  // Constants
  WEEKLY_VOLUME_RAMP_CAP,
  CTL_RAMP_CAP_PER_WEEK,
  TSB_FLOOR,
  TAPER_WINDOW_DAYS,
  RECENT_EDIT_PROTECTION_DAYS,
  // Validator
  validateOps,
  validateEditOps,
  toValidatableOp,
  isoWeekKey,
  // Types
  type EditOpKind,
  type ValidatableOp,
  type ValidatablePlan,
  type ValidatablePlannedWorkout,
  type DropReason,
  type DroppedOp,
  type ValidateResult,
  type ValidateContext,
  type TargetDateLookup,
} from "./invariants";
