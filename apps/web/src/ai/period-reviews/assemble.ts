import "server-only";

// Compose one period review's read-side pipeline: context -> facts ->
// fingerprint -> fact sheet.
//
// NOT in the plan's U6 file list, but justified: the API route (U6) and the
// scheduled delivery worker (U10) need the IDENTICAL composition, and the two
// producing different facts for the same period would be a genuinely bad bug --
// the athlete would read one set of numbers on screen and a different set in
// their inbox. Sharing the seam makes that unrepresentable rather than a thing
// two callers have to remember to keep in step.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PeriodFacts, PeriodKind } from "@da2/shared";

import { config } from "@/config";
import { computeWorkoutTss } from "@/training-load";

import { aggregatePeriod, type AggregateCompletedWorkout } from "./aggregate";
import { localDayInTimezone } from "./calendar";
import { gatherPeriodContext, type PeriodContext } from "./context";
import { buildPeriodFactSheet, type PeriodFactSheet } from "./fact-sheet";
import { computePeriodFingerprint } from "./fingerprint";

export interface AssembledPeriodReview {
  context: PeriodContext;
  facts: PeriodFacts;
  fingerprint: string;
  factSheet: PeriodFactSheet;
}

export interface AssemblePeriodReviewArgs {
  supabase: SupabaseClient;
  /** MUST be an authenticated caller id or a scheduler-selected id. */
  athleteId: string;
  kind: PeriodKind;
  periodKey: string;
  timezone: string;
}

/** Throws `InvalidPeriodKeyError` for a malformed key, and propagates a failed
 * completed_workouts read. Everything else degrades inside the gatherer. */
export async function assemblePeriodReview(
  args: AssemblePeriodReviewArgs,
): Promise<AssembledPeriodReview> {
  const context = await gatherPeriodContext(args);

  const facts = aggregatePeriod({
    kind: context.kind,
    periodKey: context.periodKey,
    bounds: context.bounds,
    timezone: context.timezone,
    completed: context.completed,
    planned: context.planned,
    previous: context.previous,
  });

  const factSheet = buildPeriodFactSheet({
    facts,
    completed: context.completed,
    localDay: (w: AggregateCompletedWorkout) =>
      localDayInTimezone(context.timezone, new Date(w.started_at)),
    loadOf: (w: AggregateCompletedWorkout) =>
      computeWorkoutTss({
        started_at: w.started_at,
        duration_s: w.duration_s,
        summary_stats: w.summary_stats,
      })?.tss ?? 0,
    goal: context.plan?.goal ?? null,
    eventDate: context.plan?.event_date ?? null,
  });

  return { context, facts, fingerprint: computePeriodFingerprint(context), factSheet };
}

/**
 * The athlete's IANA timezone, defaulting to UTC.
 *
 * Every period boundary depends on this, so a missing row must degrade rather
 * than throw -- UTC is what `users.timezone` itself defaults to (migration
 * 0001), so falling back to it produces the same answer the column would.
 */
export async function readAthleteTimezone(
  supabase: SupabaseClient,
  athleteId: string,
): Promise<string> {
  // service-role: explicit user filter required
  const { data, error } = await supabase
    .from("users")
    .select("timezone")
    .eq("id", athleteId)
    .maybeSingle();

  // A transient read failure is NOT the same as "this athlete has no timezone".
  // Silently substituting UTC would shift every period boundary and produce a
  // review of the wrong days -- so the error propagates, and UTC remains the
  // default only for an absent row or a null column (which is what the column
  // itself defaults to in migration 0001).
  if (error) {
    throw new Error(`readAthleteTimezone failed: ${error.message}`);
  }
  return (data?.timezone as string | null) ?? "UTC";
}

// ---------------------------------------------------------------------------
// Model label
// ---------------------------------------------------------------------------

// Best-effort label for `period_reviews.model`, which migration 0029 defines as
// informational. `src/llm` does not surface which model actually served a call,
// so this mirrors createLlmClient's own provider-resolution order.
//
// Lives here, beside assemblePeriodReview, for the same reason that function
// does: the API route and the delivery worker both write this column, and two
// copies would drift into labelling the same row differently depending on which
// path produced it.
const FALLBACK_ANTHROPIC_MODEL_LABEL = "claude-opus-4-8";
const FALLBACK_GROQ_MODEL_LABEL = "llama-3.3-70b-versatile";

export function resolveModelLabel(): string {
  const { anthropicApiKey, groqApiKey, provider, model } = config.llm;
  if (model) return model;
  const resolved = provider ?? (anthropicApiKey ? "anthropic" : groqApiKey ? "groq" : undefined);
  return resolved === "groq" ? FALLBACK_GROQ_MODEL_LABEL : FALLBACK_ANTHROPIC_MODEL_LABEL;
}
