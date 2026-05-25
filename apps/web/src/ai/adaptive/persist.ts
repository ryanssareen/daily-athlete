import "server-only";

// persist.ts — write a validated proposal (or a no_changes row) to
// weekly_reviews with atomic, precedence-based supersede/suppress.
//
// Routing:
//  - plan-scoped triggers  -> propose_weekly_review RPC (migration 0023): one
//    transaction, per-athlete advisory lock, supersede a lower/equal pending or
//    suppress a higher pending. NULL return = suppressed. A commit-time 23505
//    (a concurrent equal/higher trigger inserted first) is a CLEAN no-op:
//    "another proposal won; do not retry the LLM call" — never a Sentry error.
//  - workout-scoped (B7)   -> direct insert (scope-exempt from the single-open
//    index; never calls the RPC).
//  - no_changes            -> direct insert with status='no_changes' (must NOT
//    route through the RPC, since no_changes must never supersede a pending real
//    proposal). Handled by the engine, not here — exposed via persistNoChanges.
//
// Result is a typed outcome carrying counts/ids only (no PII) so the engine can
// return it straight into an Inngest step.

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ProposalRecipient,
  ProposalScope,
  ProposedEdit,
  TriggerKind,
} from "@da2/shared";

import {
  insertNoChanges,
  insertWorkoutScopedReview,
  proposePlanScopedReview,
} from "@/db/weekly-reviews";

export type PersistOutcome = "proposed" | "suppressed" | "lost_race" | "no_changes";

export interface PersistResult {
  outcome: PersistOutcome;
  /** Set only on 'proposed' / 'no_changes'. */
  reviewId?: string;
  /** Number of validated ops persisted (0 for suppressed / lost_race / no_changes). */
  opCount: number;
}

export interface PersistProposalArgs {
  admin: SupabaseClient;
  athleteId: string;
  planId: string;
  triggerKind: TriggerKind;
  scope: ProposalScope;
  recipient: ProposalRecipient;
  proposedChanges: ProposedEdit[];
  narrative: string | null;
  eventDateSnapshot: string | null;
  earliestAffectedDate: string | null;
}

/** Postgres unique-violation SQLSTATE — a lost precedence race at commit. */
const UNIQUE_VIOLATION = "23505";

/**
 * Persist a non-empty validated proposal. Routes plan-scoped through the RPC
 * (precedence + serialization) and workout-scoped through a direct insert.
 */
export async function persistProposal(
  args: PersistProposalArgs
): Promise<PersistResult> {
  const opCount = args.proposedChanges.length;

  if (args.scope === "workout") {
    // B7: scope-exempt; direct insert.
    const reviewId = await insertWorkoutScopedReview({
      admin: args.admin,
      athleteId: args.athleteId,
      planId: args.planId,
      triggerKind: args.triggerKind,
      recipient: args.recipient,
      proposedChanges: args.proposedChanges,
      narrative: args.narrative,
      eventDateSnapshot: args.eventDateSnapshot,
      earliestAffectedDate: args.earliestAffectedDate,
    });
    return { outcome: "proposed", reviewId, opCount };
  }

  // Plan-scoped: atomic supersede/suppress-then-insert via the RPC.
  try {
    const reviewId = await proposePlanScopedReview({
      admin: args.admin,
      athleteId: args.athleteId,
      planId: args.planId,
      triggerKind: args.triggerKind,
      recipient: args.recipient,
      proposedChanges: args.proposedChanges,
      narrative: args.narrative,
      eventDateSnapshot: args.eventDateSnapshot,
      earliestAffectedDate: args.earliestAffectedDate,
    });

    if (reviewId == null) {
      // RPC returned NULL: a higher-priority proposal is pending → suppressed.
      return { outcome: "suppressed", opCount: 0 };
    }
    return { outcome: "proposed", reviewId, opCount };
  } catch (err) {
    // A commit-time unique violation means a concurrent equal/higher trigger
    // won the single-open slot. Clean no-op — do NOT retry the LLM call.
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      return { outcome: "lost_race", opCount: 0 };
    }
    throw err;
  }
}

export interface PersistNoChangesArgs {
  admin: SupabaseClient;
  athleteId: string;
  planId: string;
  triggerKind: TriggerKind;
  scope: ProposalScope;
  recipient: ProposalRecipient;
  narrative: string | null;
  eventDateSnapshot: string | null;
}

/**
 * Persist a terminal `no_changes` row directly (bypasses the RPC / precedence,
 * so it can never supersede a pending real proposal). No notification is sent.
 */
export async function persistNoChanges(
  args: PersistNoChangesArgs
): Promise<PersistResult> {
  const reviewId = await insertNoChanges({
    admin: args.admin,
    athleteId: args.athleteId,
    planId: args.planId,
    triggerKind: args.triggerKind,
    scope: args.scope,
    recipient: args.recipient,
    narrative: args.narrative,
    eventDateSnapshot: args.eventDateSnapshot,
  });
  return { outcome: "no_changes", reviewId, opCount: 0 };
}
