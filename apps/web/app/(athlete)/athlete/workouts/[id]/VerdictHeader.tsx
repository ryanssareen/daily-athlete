// Deterministic verdict headline (Unit U7, docs/plans/2026-08-18-001-feat-workout-reports-plan.md).
//
// KTD1/KTD2: `verdict` is arithmetic, computed server-side by
// computeExecutionDelta (Unit U3) and handed down as plain data — this
// component renders it, it does not compute or fetch anything. No directive
// (neither "use client" nor a server-only import) — it is a pure function of
// props, safe to render from either a Server Component (page.tsx) or the
// "use client" ReportSection that composes it, and importable un-rendered
// from the vitest (Node-only) test file.

import type { Verdict, VerdictCode } from "@da2/shared";

export type VerdictTone = "positive" | "warning" | "neutral";

/**
 * Maps the closed VerdictCode vocabulary to a display tone. A switch with no
 * default so a new VerdictCode member is a compile error here, not a silent
 * "neutral" fallback.
 */
export function verdictTone(code: VerdictCode): VerdictTone {
  switch (code) {
    case "executed_as_prescribed":
      return "positive";
    case "under_executed":
    case "over_executed":
      return "warning";
    case "partial_data":
    case "unplanned_effort":
      return "neutral";
  }
}

/**
 * Short mono eyebrow above the headline. Names the verdict category so the
 * five codes stay distinguishable at a glance even when two share a tone
 * (partial_data and unplanned_effort are both neutral, but mean different
 * things). Switch with no default -- a new VerdictCode is a compile error.
 */
export function verdictLabel(code: VerdictCode): string {
  switch (code) {
    case "executed_as_prescribed":
      return "As prescribed";
    case "under_executed":
      return "Under target";
    case "over_executed":
      return "Over target";
    case "partial_data":
      return "Partial data";
    case "unplanned_effort":
      return "Unplanned";
  }
}

interface Props {
  verdict: Verdict;
}

export function VerdictHeader({ verdict }: Props) {
  const tone = verdictTone(verdict.code);
  return (
    <div className={`wd-verdict wd-verdict-${tone}`}>
      <div className="wd-verdict-body">
        <span className="wd-verdict-eyebrow">{verdictLabel(verdict.code)}</span>
        <p className="wd-verdict-headline">{verdict.headline}</p>
      </div>
    </div>
  );
}
