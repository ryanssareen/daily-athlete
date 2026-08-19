// Pure view logic for the period review UI (U7).
//
// Extracted from the renderers and the client shell so it is testable under
// this repo's Node-only vitest environment (no jsdom, no testing-library --
// see the note in src/components/__tests__/app-shell-responsive.test.ts).
// Rendering stays in the components; every decision worth asserting lives here.

import type { PeriodKind, PeriodReviewResponse } from "@da2/shared";

/**
 * Distance for display.
 *
 * An em dash, not "0.0 km", when nothing recorded a distance. The two are
 * completely different claims -- "you covered no ground" versus "nobody
 * measured" -- and an athlete reading a swim week would act on the wrong one.
 */
export function formatDistance(metres: number | null): string {
  if (metres == null || !Number.isFinite(metres)) return "—";
  return `${(metres / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatDelta(pct: number): string {
  const rounded = Math.round(pct);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/** Human label for a period, e.g. "Week of 10 Aug 2026" / "August 2026". */
export function periodLabel(kind: PeriodKind, bounds: { start: string }): string {
  const start = new Date(`${bounds.start}T00:00:00Z`);
  if (kind === "monthly") {
    return start.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return `Week of ${start.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })}`;
}

/** The hint shown under the load stat. Silent when the figure is measured;
 * explicit whenever any part of it is a duration proxy, because a proxy
 * presented bare reads as a measurement. */
export function loadHint(confidence: string): string | undefined {
  if (confidence === "power") return undefined;
  if (confidence === "none") return "no load data";
  return "partly estimated";
}

// ---------------------------------------------------------------------------
// Generation outcome
// ---------------------------------------------------------------------------

export type GenerateOutcome =
  | { phase: "generated"; narration: NonNullable<PeriodReviewResponse["narration"]>; stale: boolean }
  | { phase: "retryable" }
  | { phase: "failed" }
  | { phase: "rate_limited" }
  | { phase: "error" };

/**
 * Interpret a POST response.
 *
 * THE TRAP THIS EXISTS TO AVOID: the route returns **200 with the facts
 * intact** when narration fails (R15/AE9), so HTTP status is NOT the success
 * signal. A client that branches on `res.ok` shows a success state for a
 * response that contains no prose. What actually decides is whether
 * `narration` came back, and `retryable` then separates "try again in a
 * moment" from "trying again will not help" -- different remedies that must
 * not collapse into one generic error.
 */
export function interpretGenerateResponse(
  status: number,
  body: Partial<PeriodReviewResponse> | null,
): GenerateOutcome {
  if (status === 429) return { phase: "rate_limited" };
  if (status < 200 || status >= 300 || body == null) return { phase: "error" };

  if (body.narration) {
    return { phase: "generated", narration: body.narration, stale: body.stale === true };
  }
  return body.retryable === true ? { phase: "retryable" } : { phase: "failed" };
}

/** Label for the generate button, given what is currently on screen. */
export function generateButtonLabel(opts: {
  busy: boolean;
  hasNarration: boolean;
  stale: boolean;
}): string {
  if (opts.busy) return "Writing…";
  if (!opts.hasNarration) return "Generate note";
  return opts.stale ? "Regenerate note" : "Rewrite note";
}
