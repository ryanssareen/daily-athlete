// Pure view logic for mobile period reviews (U11).
//
// Data in, data out -- no React, no React Native. The hooks in
// ./usePeriodReviews are a thin shell over these, which is what lets the test
// suite cover the decisions without a renderer (the same split
// src/reports/report-view.ts uses, and for the same reason).

import type { PeriodKind, PeriodNarration, PeriodReviewResponse, PeriodReviewSummary } from "@da2/shared";

/**
 * How many periods the Insights tab shows.
 *
 * A CAP, not a page size. Each row costs the server a context assembly, and an
 * athlete scrolling their history must not be able to trigger an unbounded
 * fan-out of them -- the same bounding `selectRecentWorkoutIds` applies to the
 * workout list.
 */
export const RECENT_PERIODS_LIMIT = 6;

export function selectRecentPeriods(periods: PeriodReviewSummary[]): PeriodReviewSummary[] {
  return periods.slice(0, RECENT_PERIODS_LIMIT);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatDurationS(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Em dash for unknown -- never "0.0 km". Same rule as the web UI: a swim with
 * no recorded distance has UNKNOWN distance, and zero is a different claim. */
export function formatDistanceM(metres: number | null): string {
  if (metres == null || !Number.isFinite(metres)) return "—";
  return `${(metres / 1000).toFixed(1)} km`;
}

export function periodTitle(kind: PeriodKind, bounds: { start: string }): string {
  const start = new Date(`${bounds.start}T00:00:00Z`);
  if (kind === "monthly") {
    return start.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return `Week of ${start.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })}`;
}

/** One-line summary for a list row. */
export function periodSubtitle(p: PeriodReviewSummary): string {
  if (p.sessions === 0) return "No sessions logged";
  const sessions = `${p.sessions} session${p.sessions === 1 ? "" : "s"}`;
  return `${sessions} · ${formatDurationS(p.durationS)} · load ${Math.round(p.load)}`;
}

// ---------------------------------------------------------------------------
// Detail state
// ---------------------------------------------------------------------------

export type ReviewPhase = "loading" | "ready" | "not_found" | "unentitled" | "error";

export interface ReviewState {
  phase: ReviewPhase;
  response: PeriodReviewResponse | null;
  /** Set when a generate attempt finished without producing prose. */
  generateOutcome: "retryable" | "failed" | "rate_limited" | null;
  generating: boolean;
}

export const initialReviewState: ReviewState = {
  phase: "loading",
  response: null,
  generateOutcome: null,
  generating: false,
};

export type ReviewAction =
  | { type: "fetch_start" }
  | { type: "fetch_success"; response: PeriodReviewResponse }
  | { type: "fetch_not_found" }
  | { type: "fetch_unentitled" }
  | { type: "fetch_error" }
  | { type: "generate_start" }
  | { type: "generate_success"; response: PeriodReviewResponse }
  | { type: "generate_rate_limited" }
  | { type: "generate_error" };

/**
 * The reducer's defining property: `generate_start` NEVER clears `response`.
 *
 * The facts are already on screen and are still true while the narration is
 * being written; blanking them behind a spinner would take away the half of
 * the review that always works in order to wait for the half that sometimes
 * fails.
 */
export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "fetch_start":
      return { ...state, phase: state.response ? state.phase : "loading" };
    case "fetch_success":
      return { ...state, phase: "ready", response: action.response, generateOutcome: null };
    case "fetch_not_found":
      return { ...state, phase: "not_found" };
    case "fetch_unentitled":
      return { ...state, phase: "unentitled" };
    case "fetch_error":
      return { ...state, phase: state.response ? "ready" : "error" };
    case "generate_start":
      return { ...state, generating: true, generateOutcome: null };
    case "generate_success":
      return {
        ...state,
        generating: false,
        response: action.response,
        // A 200 carrying no narration is a FAILED generation. The route
        // returns the facts intact on an LLM failure, so status alone would
        // read as success -- `retryable` then separates "ask again in a
        // moment" from "asking again will not help".
        generateOutcome: action.response.narration
          ? null
          : action.response.retryable === true
            ? "retryable"
            : "failed",
      };
    case "generate_rate_limited":
      return { ...state, generating: false, generateOutcome: "rate_limited" };
    case "generate_error":
      return { ...state, generating: false, generateOutcome: "failed" };
    default:
      return state;
  }
}

export interface ReviewView {
  facts: PeriodReviewResponse["facts"];
  narration: PeriodNarration | null;
  stale: boolean;
  /** Message to show when a generate attempt produced no prose. */
  notice: string | null;
}

const NOTICES: Record<NonNullable<ReviewState["generateOutcome"]>, string> = {
  retryable: "The coaching model is busy. Your numbers are all here — try the note again shortly.",
  rate_limited: "You've generated a lot of reviews recently. Try again a little later.",
  failed: "We couldn't write a note for this period. Your numbers above are unaffected.",
};

export function selectReviewView(state: ReviewState): ReviewView | null {
  if (!state.response) return null;
  return {
    facts: state.response.facts,
    narration: state.response.narration,
    stale: state.response.stale,
    notice: state.generateOutcome ? NOTICES[state.generateOutcome] : null,
  };
}
