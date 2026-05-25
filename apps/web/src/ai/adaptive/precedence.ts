// Trigger precedence for the AI adaptive re-plan engine — a PURE module.
//
// The engine persists at most one open *plan-scoped* proposal per athlete. When
// a new plan-scoped trigger fires while another plan-scoped proposal is still
// pending, precedence decides whether the incoming proposal supersedes the
// pending one, is suppressed in its favour, or simply inserts (nothing pending).
//
// Full precedence order (highest first):
//   B4 event_change > B2 missed_block > B5 fatigue_deload > B1 weekly
//   > B6 progression_bump > B7 workout_swap.   manual ranks WITH weekly.
// B5/B6 are deferred from v1 but kept in the ranking so adding them later is
// purely additive (a new trigger extends the function — no global re-ranking).
//
// IMPORTANT: `triggerPriority` below MUST stay in lockstep with the SQL
// `trigger_priority` CASE in
//   supabase/migrations/0023_propose_weekly_review_rpc.sql
// The RPC re-evaluates priority server-side under the per-athlete advisory lock
// (it is the authoritative serializer); this TS copy lets the engine decide
// *before* spending an LLM call whether generation is even worth it. If they
// drift, the engine and the DB will disagree about supersede vs. suppress.

import type { TriggerKind } from "@da2/shared";

/**
 * Numeric priority of a trigger. Higher wins. MUST mirror the SQL
 * `trigger_priority` CASE in migration 0023 — keep them in lockstep.
 */
export function triggerPriority(kind: TriggerKind): number {
  switch (kind) {
    case "event_change":
      return 60;
    case "missed_block":
      return 50;
    case "fatigue_deload":
      return 40;
    case "weekly":
      return 30;
    case "manual":
      return 30;
    case "progression_bump":
      return 20;
    case "workout_swap":
      return 10;
    case "schedule_shock":
      // B3 is not enumerated in the SQL `trigger_priority` CASE, so it falls to
      // the SQL `ELSE 0` branch. Mirror that exactly to stay in lockstep with
      // 0023 (Unit 10 may promote it into the CASE; do it in BOTH places).
      return 0;
    default: {
      // Exhaustiveness guard: a new TriggerKind must be ranked explicitly.
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Whether a trigger's proposal is *coupled* (a coordinated, all-or-nothing set)
 * vs. *independent* (ops may partial-apply). Coupled proposals are aborted to
 * `superseded` at apply if ANY op is dropped/stale (Unit 6) rather than leaving
 * the plan half-adjusted (e.g. easy-volume cut applied but the intensity cut
 * dropped).
 *
 * Everything is coupled EXCEPT `workout_swap` (B7): a single on-demand swap is
 * inherently independent — there is nothing to coordinate it with.
 */
export function isCoupled(kind: TriggerKind): boolean {
  return kind !== "workout_swap";
}

/**
 * Precedence decision for a plan-scoped incoming trigger.
 *
 * - `insert`     — nothing pending; just create the proposal.
 * - `supersede`  — incoming priority >= pending priority; replace the pending
 *                  proposal (the SQL RPC does the supersede+insert atomically).
 * - `suppress`   — incoming priority < pending priority; do NOT generate (the
 *                  pending higher-priority proposal stands).
 *
 * Ties go to the incoming trigger (>=), matching the SQL RPC: a fresher
 * equal-priority proposal (e.g. a new weekly review) replaces a stale one.
 */
export type PrecedenceDecision = "insert" | "supersede" | "suppress";

export function decidePrecedence(
  incomingKind: TriggerKind,
  pendingKind: TriggerKind | null
): PrecedenceDecision {
  if (pendingKind == null) return "insert";
  const incoming = triggerPriority(incomingKind);
  const pending = triggerPriority(pendingKind);
  // Mirror the SQL: incoming < pending → suppress; otherwise supersede.
  return incoming < pending ? "suppress" : "supersede";
}
