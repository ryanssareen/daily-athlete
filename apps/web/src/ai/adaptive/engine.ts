import "server-only";

// engine.ts — the AI adaptive re-plan orchestrator.
//
// One engine, many triggers. Given a trigger + an athlete, it:
//   1. (plan-scoped) checks precedence against any pending proposal and
//      SUPPRESSES BEFORE spending an LLM call when a higher-priority proposal is
//      already pending.
//   2. gathers + snapshots context (plan_id, event_date, per-op {version}
//      baselines, completed-workout load state) via Promise.allSettled.
//   3. asks the proposer for an EditOp diff, safeParse + retry (<=3) on invalid.
//   4. runs the deterministic validator (Unit 4), dropping unsafe ops.
//   5. if the surviving diff is empty -> persists a terminal `no_changes` row
//      directly (NOT via the precedence RPC; no_changes must never supersede a
//      pending real proposal) and sends NO notification.
//   6. else builds ProposedEdit[] (op + {version} baseline) and persists the
//      proposal atomically (supersede/suppress-then-insert; 23505 = clean no-op).
//
// Inngest step returns carry COUNTS / IDS ONLY (no PII): see EngineResult.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  NARRATIVE_MAX_LENGTH,
  type EditOp,
  type ProposalRecipient,
  type ProposalScope,
  type ProposedEdit,
  type TriggerKind,
} from "@da2/shared";

import { validateEditOps } from "@/training-load/invariants";

import {
  baselineForOp,
  earliestAffectedDate,
  gatherContext,
  NoActivePlanError,
  type PlanContext,
} from "./context";
import type { AdaptiveProposer } from "./llm";
import { decidePrecedence } from "./precedence";
import { persistNoChanges, persistProposal, type PersistResult } from "./persist";
import { propose } from "./propose";

export type EngineOutcome =
  | PersistResult["outcome"]
  | "no_active_plan"
  | "suppressed_pre_generation";

/** Counts/ids-only result — safe to return from an Inngest step (no PII). */
export interface EngineResult {
  outcome: EngineOutcome;
  reviewId?: string;
  /** Validated ops persisted. */
  opCount: number;
  /** Ops the validator dropped (reported, never persisted). */
  droppedCount: number;
}

export interface RunEngineArgs {
  admin: SupabaseClient;
  athleteId: string;
  triggerKind: TriggerKind;
  scope: ProposalScope;
  recipient: ProposalRecipient;
  proposer: AdaptiveProposer;
  /** "today" as athlete-local "YYYY-MM-DD" (resolved by the caller). */
  asOf: string;
}

/**
 * Run the adaptive engine for one trigger. Returns a counts/ids-only result.
 * Throws ProposeError when the proposer fails all retries (the caller leaves NO
 * row written) and rethrows unexpected DB errors; a NoActivePlanError is mapped
 * to a benign `no_active_plan` outcome (nothing to re-plan).
 */
export async function runEngine(args: RunEngineArgs): Promise<EngineResult> {
  const { admin, athleteId, triggerKind, scope, recipient, proposer, asOf } = args;

  // 1. Precedence pre-check (plan-scoped only) — suppress BEFORE the LLM call.
  if (scope === "plan") {
    const pending = await getPendingTriggerKind(admin, athleteId);
    if (decidePrecedence(triggerKind, pending) === "suppress") {
      return { outcome: "suppressed_pre_generation", opCount: 0, droppedCount: 0 };
    }
  }

  // 2. Gather + snapshot context.
  let context: PlanContext;
  try {
    context = await gatherContext({ admin, athleteId, asOf });
  } catch (err) {
    if (err instanceof NoActivePlanError) {
      return { outcome: "no_active_plan", opCount: 0, droppedCount: 0 };
    }
    throw err;
  }

  // 3. Propose (parse + retry on invalid). Throws ProposeError on exhaustion.
  const candidateOps = await propose({ proposer, context, triggerKind });

  // 4. Deterministic validation — drop unsafe ops (incl. coach-protected rows).
  const { valid, dropped } = validateEditOps(
    { event_date: context.plan.event_date },
    candidateOps,
    {
      plannedWorkouts: context.plannedWorkouts,
      loadState: context.loadState,
      completedWorkouts: context.completedWorkouts,
      asOf,
    }
  );

  const eventDateSnapshot = context.plan.event_date;

  // 5. Empty / all-dropped -> terminal no_changes (direct insert; no notify).
  if (valid.length === 0) {
    const result = await persistNoChanges({
      admin,
      athleteId,
      planId: context.plan.id,
      triggerKind,
      scope,
      recipient,
      narrative: null,
      eventDateSnapshot,
    });
    return {
      outcome: result.outcome,
      reviewId: result.reviewId,
      opCount: 0,
      droppedCount: dropped.length,
    };
  }

  // 6. Build ProposedEdit[] (op + {version} baseline) and persist.
  const proposedChanges: ProposedEdit[] = valid.map((op) => ({
    op,
    baseline: baselineForOp(op, context.plannedWorkouts),
  }));

  const result = await persistProposal({
    admin,
    athleteId,
    planId: context.plan.id,
    triggerKind,
    scope,
    recipient,
    proposedChanges,
    narrative: buildNarrative(valid, triggerKind),
    eventDateSnapshot,
    earliestAffectedDate: earliestAffectedDate(valid, context.plannedWorkouts),
  });

  return {
    outcome: result.outcome,
    reviewId: result.reviewId,
    opCount: result.opCount,
    droppedCount: dropped.length,
  };
}

/** The pending plan-scoped proposal's trigger kind (precedence input), or null. */
async function getPendingTriggerKind(
  admin: SupabaseClient,
  athleteId: string
): Promise<TriggerKind | null> {
  const { getOpenPlanScopedProposal } = await import("@/db/weekly-reviews");
  const pending = await getOpenPlanScopedProposal(admin, athleteId);
  return pending?.trigger_kind ?? null;
}

/**
 * A short, plain-text narrative for the proposal, length-capped to
 * NARRATIVE_MAX_LENGTH (untrusted-string convention; the real LLM narrative
 * replaces this once the live client lands). Kept deterministic for tests.
 */
function buildNarrative(ops: EditOp[], triggerKind: TriggerKind): string {
  const label = TRIGGER_LABELS[triggerKind];
  const text = `${label}: ${ops.length} change${ops.length === 1 ? "" : "s"} proposed.`;
  return text.length > NARRATIVE_MAX_LENGTH ? text.slice(0, NARRATIVE_MAX_LENGTH) : text;
}

const TRIGGER_LABELS: Record<TriggerKind, string> = {
  weekly: "Weekly review",
  missed_block: "Based on missed workouts",
  schedule_shock: "Based on your availability change",
  event_change: "You changed your event date",
  fatigue_deload: "Based on your recent load",
  progression_bump: "Based on your recent progress",
  workout_swap: "Workout swap",
  manual: "Requested replan",
};
