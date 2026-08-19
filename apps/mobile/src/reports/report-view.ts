// Pure view-model + state-machine layer for the mobile per-workout report
// surface (Unit U8, docs/plans/2026-08-18-001-feat-workout-reports-plan.md).
//
// Everything in this file is plain data-in/data-out logic -- no React, no
// React Native, no `api()` / Supabase calls -- so it is unit-testable in the
// mobile vitest environment, which is Node-only and cannot import
// react-native/expo (see apps/mobile/vitest.config.ts). This mirrors
// src/adaptive/proposal-view.ts: useWorkoutReport.ts (the RN-entangled shell)
// is a thin `useReducer` wrapper that dispatches events into `reportReducer`
// below and reads the screen's props via `selectReportView`.
//
// KTD2 (the plan's defining property for this unit): the delta/verdict is
// computed on GET and carries no LLM dependency, so it must render the
// instant the GET resolves, and it must NOT disappear or blank out while a
// POST (narrative generation) is in flight. That invariant is structural
// here: `generate_start` only flips `generating`; it never touches
// `response`, so `selectReportView` keeps producing the last-known verdict +
// comparison throughout the POST. See useWorkoutReport.test.ts for the test
// that pins this.

import type {
  DimensionDelta,
  ExecutionDelta,
  IntensityDimensionDelta,
  IntensityTarget,
  Verdict,
  WorkoutReportResponse,
} from "@da2/shared";

// ---------------------------------------------------------------------------
// Comparison view (the deterministic delta section)
// ---------------------------------------------------------------------------

export interface DimensionRow {
  key: "duration" | "load" | "intensity";
  label: string;
  status: "on_target" | "under" | "over";
  prescribed: number;
  actual: number;
  deltaPct: number;
  /** Only intensity carries this -- what the number is relative to (75% FTP / Zone 3 / a pace). */
  targetLabel?: string;
  /** Only intensity carries this -- lets the screen format prescribed/actual with the right unit. */
  intensityKind?: IntensityTarget["kind"];
}

/** Formats a dimension's prescribed/actual number with the right unit for its kind. */
export function formatDimensionValue(row: Pick<DimensionRow, "key" | "intensityKind">, value: number): string {
  if (row.key === "duration") return formatDurationS(value);
  if (row.key === "load") return `${Math.round(value)} TSS`;
  switch (row.intensityKind) {
    case "ftp_pct":
      return `${Math.round(value)}% FTP`;
    case "zone":
      // %HRmax, not a zone number -- resolveIntensity converts a zone target
      // to its midpoint %HRmax before comparing. targetLabel still carries the
      // zone identity ("Zone 3"), so nothing is lost by labelling the unit.
      return `${Math.round(value)}% HR max`;
    case "pace_s_per_km":
      return `${formatPace(value)}/km`;
    default:
      return `${value}`;
  }
}

export function formatDurationS(seconds: number): string {
  const total = Math.round(Math.abs(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Discriminated on `matched`, mirroring ExecutionDeltaSchema: an unmatched
// workout has NO `rows` key at all, not an empty array standing in for one --
// the screen renders no comparison section, full stop (R4 / AE3).
export type ComparisonView = { matched: true; rows: DimensionRow[] } | { matched: false };

function describeIntensityTarget(target: IntensityTarget): string {
  switch (target.kind) {
    case "ftp_pct":
      return `${target.value}% FTP`;
    case "zone":
      return `Zone ${target.value}`;
    case "pace_s_per_km":
      return `${formatPace(target.value)}/km`;
  }
}

function formatPace(secPerKm: number): string {
  const minutes = Math.floor(secPerKm / 60);
  const seconds = Math.round(secPerKm % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// A dimension with status "unavailable" is OMITTED entirely -- never
// rendered as a dash or "n/a" (U8 constraint). `pushRow`/`pushIntensityRow`
// are the single choke point that enforces this.
function pushRow(rows: DimensionRow[], key: DimensionRow["key"], label: string, dimension: DimensionDelta): void {
  if (dimension.status === "unavailable") return;
  rows.push({
    key,
    label,
    status: dimension.status,
    prescribed: dimension.prescribed,
    actual: dimension.actual,
    deltaPct: dimension.deltaPct,
  });
}

function pushIntensityRow(rows: DimensionRow[], dimension: IntensityDimensionDelta): void {
  if (dimension.status === "unavailable") return;
  rows.push({
    key: "intensity",
    label: "Intensity",
    status: dimension.status,
    prescribed: dimension.prescribed,
    actual: dimension.actual,
    deltaPct: dimension.deltaPct,
    targetLabel: describeIntensityTarget(dimension.target),
    intensityKind: dimension.target.kind,
  });
}

export function toComparisonView(delta: ExecutionDelta): ComparisonView {
  if (!delta.matched) return { matched: false };
  const rows: DimensionRow[] = [];
  pushRow(rows, "duration", "Duration", delta.dimensions.duration);
  pushRow(rows, "load", "Load", delta.dimensions.load);
  pushIntensityRow(rows, delta.dimensions.intensity);
  return { matched: true, rows };
}

// ---------------------------------------------------------------------------
// Narrative view -- the required states
// ---------------------------------------------------------------------------

export type NarrativeView =
  // No narrative has ever been generated for this workout.
  | { status: "absent" }
  // A cached narrative, fingerprint-fresh.
  | { status: "present"; note: string; takeaway: string }
  // A cached narrative whose fingerprint no longer matches (R9) -- STILL
  // shown (never hidden), plus a regenerate affordance.
  | { status: "stale"; note: string; takeaway: string }
  // A cached narrative written against a DIFFERENT verdict category than the
  // one now shown above it (`verdictChanged`). Deliberately carries no note:
  // prose saying "you came up short" under an "As prescribed" verdict
  // contradicts the header, and the athlete has no way to tell which is
  // right. Withheld with an explanation, plus a regenerate affordance.
  | { status: "superseded" }
  // A generate/regenerate attempt just failed in a way worth retrying
  // (LlmRateLimited/transient -- AE6). Not an error screen.
  | { status: "retryable" }
  // A generate/regenerate attempt failed permanently (bad model output).
  // Still not a crash/error screen -- just no retry offered.
  | { status: "failed" };

/** Ephemeral, hook-local memory of the last POST's outcome when it did not
 * produce a narration. Not part of WorkoutReportResponse -- `retryable` only
 * ever appears on a POST response, per the route contract. */
export interface PostOutcome {
  retryable: boolean;
}

// A FAILED ATTEMPT NEVER DESTROYS A DISPLAYED NOTE. When regeneration fails
// the route writes no row and hands back the narrative that is STILL stored,
// so `response.narration` is the truth in the database either way. The
// postOutcome branch therefore only takes over when there is no prose to
// show -- otherwise the note stays on screen and `attemptFailed` (below)
// carries the failure so the screen can render the retry copy beside it.
function toNarrativeView(response: WorkoutReportResponse, postOutcome: PostOutcome | null): NarrativeView {
  if (!response.narration) {
    if (postOutcome) return postOutcome.retryable ? { status: "retryable" } : { status: "failed" };
    return { status: "absent" };
  }
  if (response.verdictChanged) return { status: "superseded" };
  if (response.stale) {
    return { status: "stale", note: response.narration.note, takeaway: response.narration.takeaway };
  }
  return { status: "present", note: response.narration.note, takeaway: response.narration.takeaway };
}

// ---------------------------------------------------------------------------
// Full report view model
// ---------------------------------------------------------------------------

export interface ReportView {
  verdict: Verdict;
  comparison: ComparisonView;
  narrative: NarrativeView;
  /** Mirrors WorkoutReportResponse.generatable -- whether generate/regenerate/retry may be offered. */
  canRequestNarrative: boolean;
  /** The last generate attempt failed to produce a FRESH narrative, even
   * though an older one may still be shown above. Drives the "couldn't
   * refresh this" copy + retry affordance beside a surviving note. */
  attemptFailed: boolean;
  /** Whether that failure is worth retrying (false = the model produced
   * unusable output; asking again is unlikely to help). */
  attemptRetryable: boolean;
}

export function toReportView(response: WorkoutReportResponse, postOutcome: PostOutcome | null = null): ReportView {
  return {
    verdict: response.delta.verdict,
    comparison: toComparisonView(response.delta),
    narrative: toNarrativeView(response, postOutcome),
    canRequestNarrative: response.generatable,
    attemptFailed: postOutcome !== null,
    attemptRetryable: postOutcome?.retryable ?? false,
  };
}

// ---------------------------------------------------------------------------
// Hook state machine (useWorkoutReport.ts dispatches these; kept pure/pin-able)
// ---------------------------------------------------------------------------

export type ReportPhase = "loading" | "ready" | "not_found" | "error";

export interface ReportState {
  phase: ReportPhase;
  response: WorkoutReportResponse | null;
  generating: boolean;
  postOutcome: PostOutcome | null;
}

export const initialReportState: ReportState = {
  phase: "loading",
  response: null,
  generating: false,
  postOutcome: null,
};

/** What POST /report can additionally carry beyond WorkoutReportResponse
 * (see route.ts + this unit's report-back on the schema/route conflict). */
export type GenerateResponse = WorkoutReportResponse & { retryable?: boolean };

export type ReportEvent =
  | { type: "fetch_start" }
  | { type: "fetch_success"; response: WorkoutReportResponse }
  | { type: "fetch_not_found" }
  | { type: "fetch_error" }
  // Dispatched the instant generate() is called -- deliberately does NOT
  // touch `response`, which is what keeps the verdict/comparison on screen
  // for the whole lifetime of the POST (KTD2's UX consequence).
  | { type: "generate_start" }
  | { type: "generate_success"; response: GenerateResponse }
  // The POST call itself threw (network error, unmodeled 5xx, etc.) rather
  // than resolving with a modeled `{narration: null, retryable}` body. Not
  // any of AE6's cases; treated as retryable since "try again" is the only
  // reasonable affordance for a plain network failure.
  | { type: "generate_error" };

export function reportReducer(state: ReportState, event: ReportEvent): ReportState {
  switch (event.type) {
    case "fetch_start":
      return { ...state, phase: "loading" };
    case "fetch_success":
      return { phase: "ready", response: event.response, generating: false, postOutcome: null };
    case "fetch_not_found":
      return { phase: "not_found", response: null, generating: false, postOutcome: null };
    case "fetch_error":
      return { phase: "error", response: null, generating: false, postOutcome: null };
    case "generate_start":
      return { ...state, generating: true };
    case "generate_success": {
      const { retryable, ...response } = event.response;
      // `retryable`'s PRESENCE is the signal that an attempt was made and did
      // not produce a fresh narrative -- see WorkoutReportResponseSchema. It
      // is deliberately NOT conditioned on `narration === null`: the route
      // hands back the still-stored note on a failure (it wrote no row), so
      // requiring a null narration here would silently swallow every failure
      // that happened over an existing note and leave the athlete staring at
      // an unchanged note with no indication the refresh failed.
      const attemptFailed = typeof retryable === "boolean";
      return {
        phase: "ready",
        response,
        generating: false,
        postOutcome: attemptFailed ? { retryable } : null,
      };
    }
    case "generate_error":
      return { ...state, generating: false, postOutcome: { retryable: true } };
    default:
      return state;
  }
}

export function selectReportView(state: ReportState): ReportView | null {
  if (!state.response) return null;
  return toReportView(state.response, state.postOutcome);
}

// ---------------------------------------------------------------------------
// Insights tab: bounding the recent-workouts list so it can never fan out
// into a request storm, regardless of how many completed_workouts rows the
// athlete has. useWorkoutReport.ts fetches at most this many verdicts.
// ---------------------------------------------------------------------------

export const RECENT_WORKOUTS_LIMIT = 20;

/** Caps the id list the Insights tab fetches verdicts for. Applied
 * independently of the DB query's own LIMIT so the guarantee holds even if
 * that query is ever loosened. Zero input -> zero output -> zero requests. */
export function selectRecentWorkoutIds(workoutIds: readonly string[], limit: number = RECENT_WORKOUTS_LIMIT): string[] {
  return workoutIds.slice(0, limit);
}
