"use client";

// Report section — verdict + comparison + narrative (Unit U7,
// docs/plans/2026-08-18-001-feat-workout-reports-plan.md).
//
// KTD2 / F1-F4 GUARD: the verdict and comparison are already-computed data
// (page.tsx assembles them server-side via the same building blocks GET
// /api/workouts/[id]/report uses — gatherReportContext + computeExecutionDelta
// + computeFingerprint — and passes the result down as `initialReport`, a
// plain prop). This component therefore renders <VerdictHeader> and
// <ComparisonRows> UNCONDITIONALLY at the top of `render()`, before any
// narrative-state branching, and never gates them on `pending`. Only the
// narrative area below has a loading state. See ReportSection.test.tsx's
// "KTD2 guard" test, which pins that `startGenerate` — the pending
// transition — leaves `state.report.delta` byte-identical: the pending flag
// never clears/replaces the verdict-bearing data.
//
// The five narrative states:
//   absent            — narration: null, no prior attempt -> "Show report"
//                         button; generation is explicit, never triggered on
//                         mount (auto-generating on every fresh workout view
//                         made the page feel like it hung on an LLM call)
//   present            — narration present, not stale -> note + takeaway
//   stale              — narration present, stale: true -> note + takeaway
//                         PLUS a stale marker and a regenerate affordance
//   superseded         — narration present but `verdictChanged`: the stored
//                         prose explains a verdict CATEGORY the fresh delta
//                         no longer produces. The note is SUPPRESSED, not
//                         badged: a note reading "you came up short" sitting
//                         under an "As prescribed" header is worse than no
//                         note at all, because the two visibly contradict
//                         and the athlete cannot tell which to believe.
//   retryable_failed   — a generate/regenerate attempt returned
//                         narration: null with `retryable` set (true or
//                         false) -> a retry affordance (retryable: true) or
//                         a static failure message (retryable: false, per
//                         the schema's own comment: "asking again is
//                         unlikely to help"). Never an error boundary —
//                         the verdict/comparison above render regardless.
//
// A FAILED ATTEMPT NEVER DESTROYS A DISPLAYED NOTE. The route returns the
// still-stored narrative alongside `retryable` when regeneration fails (it
// wrote no row, so the old note is still the truth in the database), and the
// states above are orthogonal to that flag: a failed regeneration over an
// existing note lands in `stale`/`present`, keeps the prose on screen, and
// adds the failure copy plus a retry button beneath it. Only a failure with
// nothing stored at all reaches `retryable_failed`.

import { useState } from "react";

import { WorkoutReportResponseSchema, type WorkoutReportResponse } from "@da2/shared";

import { ComparisonRows } from "./ComparisonRows";
import { VerdictHeader } from "./VerdictHeader";

// ---------------------------------------------------------------------------
// Narrative view-state derivation (pure, tested directly — see
// ReportSection.test.tsx).
// ---------------------------------------------------------------------------

export type NarrativeViewKind = "absent" | "present" | "stale" | "superseded" | "retryable_failed";

/** Copy shown when the stored note was written against a different verdict
 * category than the one now displayed above it (see `superseded`). */
export const SUPERSEDED_MESSAGE =
  "This workout's data changed and the verdict along with it — the previous note no longer describes it.";

type ReportProjection = Pick<
  WorkoutReportResponse,
  "narration" | "stale" | "retryable" | "verdictChanged"
>;

/**
 * `retryable` is present ONLY right after a generate/regenerate attempt
 * that did not produce a NEW narration (see WorkoutReportResponseSchema's own
 * comment) — absent on every GET and on a successful POST. Its presence,
 * not its value, is what signals "an attempt happened and failed".
 *
 * Note the ORDER: `verdictChanged` outranks `stale`, and both outrank a
 * failed attempt that still returned prose. A failed attempt only picks the
 * `retryable_failed` state when there is no narration to show at all.
 */
export function narrativeStateFor(report: ReportProjection): NarrativeViewKind {
  if (report.narration === null) {
    return report.retryable !== undefined ? "retryable_failed" : "absent";
  }
  if (report.verdictChanged) return "superseded";
  return report.stale ? "stale" : "present";
}

/** True when this payload came back from an attempt that failed to produce a
 * fresh narrative — regardless of whether an older one survived to be shown. */
export function attemptFailed(report: ReportProjection): boolean {
  return report.retryable !== undefined;
}

/**
 * Everything the narrative area renders, derived once so the JSX below and
 * ReportSection.test.tsx read from the SAME function — a test asserting
 * `generateLabel === "Generate report"` is asserting exactly what the button
 * below renders, not a parallel reimplementation that could drift from it.
 */
export interface NarrativeAffordances {
  kind: NarrativeViewKind;
  /** Show the stored note + takeaway (present AND stale both do; `superseded`
   * deliberately does NOT — see the module header). */
  showNote: boolean;
  /** "Out of date" badge (stale only). */
  showStaleBadge: boolean;
  /** Why the stored prose is being withheld (`superseded` only). */
  supersededMessage: string | null;
  /** Failure copy for an attempt that produced no fresh narrative. Set
   * whenever an attempt failed, including when an older note is still on
   * screen beside it. */
  retryMessage: string | null;
  /** Label for the single generate/regenerate/retry button, or null when no
   * such button is shown (a healthy `present`, and any failure the schema
   * marks as not worth retrying). */
  actionLabel: string | null;
  actionDisabled: boolean;
}

export function narrativeAffordances(
  report: ReportProjection,
  pending: boolean
): NarrativeAffordances {
  const kind = narrativeStateFor(report);
  const showNote = kind === "present" || kind === "stale";
  const showStaleBadge = kind === "stale";
  const failed = attemptFailed(report);

  let actionLabel: string | null = null;
  if (kind === "absent") actionLabel = pending ? "Generating…" : "Show report";
  else if (kind === "stale" || kind === "superseded") {
    actionLabel = pending ? "Regenerating…" : "Regenerate report";
  } else if (kind === "retryable_failed" && report.retryable) {
    actionLabel = pending ? "Retrying…" : "Try again";
  } else if (kind === "present" && failed && report.retryable) {
    // A healthy note whose refresh just failed: the note stays, but the
    // athlete still needs a way to ask again.
    actionLabel = pending ? "Retrying…" : "Try again";
  }

  const retryMessage = failed
    ? report.retryable
      ? "We couldn't generate a narrative right now."
      : "We couldn't generate a narrative for this workout."
    : null;

  return {
    kind,
    showNote,
    showStaleBadge,
    supersededMessage: kind === "superseded" ? SUPERSEDED_MESSAGE : null,
    retryMessage,
    actionLabel,
    actionDisabled: pending,
  };
}

// ---------------------------------------------------------------------------
// Pure state machine for the generate/regenerate interaction. Extracted so
// the KTD2 guard (verdict/comparison data survives a pending transition
// untouched) is directly unit-testable without a renderer.
// ---------------------------------------------------------------------------

export interface ReportViewState {
  report: WorkoutReportResponse;
  pending: boolean;
  /** Set only on an unexpected transport failure (network error, non-200,
   * invalid payload) — distinct from a modeled narration failure, which the
   * API reports as a 200 with `retryable` set (see narrativeStateFor). */
  requestError: string | null;
}

export function startGenerate(state: ReportViewState): ReportViewState {
  return { ...state, pending: true, requestError: null };
}

export function finishGenerate(state: ReportViewState, result: WorkoutReportResponse): ReportViewState {
  return { report: result, pending: false, requestError: null };
}

export function failGenerate(state: ReportViewState, message: string): ReportViewState {
  return { ...state, pending: false, requestError: message };
}

// ---------------------------------------------------------------------------
// Fetch seam (overridable in tests; mirrors ProposalReview.tsx's
// defaultProposalApi pattern).
// ---------------------------------------------------------------------------

export interface ReportApi {
  generate: (workoutId: string) => Promise<WorkoutReportResponse>;
}

async function parseJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export const defaultReportApi: ReportApi = {
  async generate(workoutId) {
    const res = await fetch(`/api/workouts/${workoutId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`generate failed: ${res.status}`);
    const body = await parseJson(res);
    const parsed = WorkoutReportResponseSchema.safeParse(body);
    if (!parsed.success) throw new Error("generate returned an invalid payload");
    return parsed.data;
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  workoutId: string;
  initialReport: WorkoutReportResponse;
  api?: ReportApi;
}

export function ReportSection({ workoutId, initialReport, api = defaultReportApi }: Props) {
  const [state, setState] = useState<ReportViewState>({
    report: initialReport,
    pending: false,
    requestError: null,
  });

  async function handleGenerate() {
    setState(startGenerate);
    try {
      const result = await api.generate(workoutId);
      setState((s) => finishGenerate(s, result));
    } catch {
      setState((s) => failGenerate(s, "Couldn't generate the report. Try again."));
    }
  }

  const { report, pending, requestError } = state;
  const aff = narrativeAffordances(report, pending);

  return (
    <section className="wd-report">
      <header className="wd-report-head">
        <div className="wd-section-eyebrow">Debrief</div>
        <h2 className="wd-section-title">Report</h2>
      </header>

      {/* Verdict + comparison: unconditional, no loading gate (KTD2). */}
      <VerdictHeader verdict={report.delta.verdict} />
      {report.delta.matched ? (
        <ComparisonRows delta={report.delta} />
      ) : (
        /* Unmatched: a thin metadata line rather than an absent card, so the
           section reads as designed-this-way instead of half-loaded. */
        <p className="wd-report-freeform">Freeform &middot; not compared to a plan</p>
      )}

      <div className="wd-report-narrative">
        {/* Skeleton is scoped to the narrative alone -- the verdict and
            comparison above stay fully rendered while the note generates. */}
        {pending && !aff.showNote && (
          <div className="wd-report-skeleton" aria-label="Generating report" aria-live="polite">
            <span />
            <span />
            <span />
          </div>
        )}
        {aff.showNote && report.narration && (
          <>
            <p className="wd-report-note">{report.narration.note}</p>
            <p className="wd-report-takeaway">
              <strong>Takeaway —</strong> {report.narration.takeaway}
            </p>
          </>
        )}

        {aff.supersededMessage && (
          <p className="wd-report-superseded">{aff.supersededMessage}</p>
        )}

        {aff.showStaleBadge && (
          <div className="wd-report-stale-bar">
            <span className="wd-report-stale-badge">Out of date</span>
            {aff.actionLabel && (
              <button type="button" className="wd-report-action" onClick={handleGenerate} disabled={aff.actionDisabled}>
                {aff.actionLabel}
              </button>
            )}
          </div>
        )}

        {/* The generate/regenerate button for every state that doesn't nest
            it inside a bar of its own (stale) or a failure block (below). */}
        {(aff.kind === "absent" || aff.kind === "superseded") && aff.actionLabel && (
          <button type="button" className="wd-report-action" onClick={handleGenerate} disabled={aff.actionDisabled}>
            {aff.actionLabel}
          </button>
        )}

        {/* Failure copy. Rendered whenever an attempt failed — including
            beneath a surviving note (kind "present"/"stale"), which is the
            whole point of the route handing the old narrative back rather
            than nulling it. The button lives here only for the two kinds
            that have not already rendered one above (stale renders it in the
            badge bar, superseded in its own block) — exactly one
            generate/regenerate/retry control is ever on screen. */}
        {aff.retryMessage && (
          <div className="wd-report-retry">
            <p className="wd-report-retry-msg">{aff.retryMessage}</p>
            {aff.actionLabel && (aff.kind === "retryable_failed" || aff.kind === "present") && (
              <button type="button" className="wd-report-action" onClick={handleGenerate} disabled={aff.actionDisabled}>
                {aff.actionLabel}
              </button>
            )}
          </div>
        )}

        {requestError && <p className="wd-report-error">{requestError}</p>}
      </div>
    </section>
  );
}
