// Deterministic feasibility gate — runs BEFORE any model call so we never spend
// LLM tokens on a clearly impossible ask. The nuanced cases ("Ironman in 6
// weeks for a beginner") are also caught downstream: the prompt instructs the
// model to refuse, and validateGeneratedPlan rejects an unsafe plan. This gate
// owns only the clear-cut, cheap-to-decide refusals.

import { isFutureEventDate, type GeneratePlanInput } from "@da2/shared";

import { dayDiff } from "@/training-load";

// Below this, there is not enough runway to build a meaningfully periodized,
// safe plan to an event.
export const MIN_PLAN_WEEKS = 2;

export interface FeasibilityResult {
  feasible: boolean;
  /** Athlete-facing reason when infeasible (plain text). */
  reason?: string;
}

export function assessFeasibility(
  input: GeneratePlanInput,
  today: string
): FeasibilityResult {
  if (input.event_date) {
    if (!isFutureEventDate(input.event_date, today)) {
      return { feasible: false, reason: "The event date is in the past." };
    }
    const weeks = dayDiff(today, input.event_date) / 7;
    if (weeks < MIN_PLAN_WEEKS) {
      return {
        feasible: false,
        reason: `There are only about ${weeks.toFixed(
          1
        )} weeks until your event — not enough time to build a safe, periodized plan.`,
      };
    }
  }
  return { feasible: true };
}
