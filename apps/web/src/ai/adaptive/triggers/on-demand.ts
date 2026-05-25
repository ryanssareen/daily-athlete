// On-demand adaptive-engine triggers (plan Unit 10).
//
// Athlete/coach-initiated entry points into the SAME single engine runner
// (`adaptive/run.requested`). Covers:
//   - R11 manual          → trigger_kind 'manual',         scope 'plan'
//   - B3 schedule-shock   → trigger_kind 'schedule_shock', scope 'plan'
//   - B4 event-change     → trigger_kind 'event_change',   scope 'plan'
//   - B7 single-swap      → trigger_kind 'workout_swap',   scope 'workout'
//
// "One engine, many triggers." Every on-demand request enqueues the generic
// ADAPTIVE_RUN_EVENT with its own trigger_kind + scope. On-demand triggers MUST
// always run, so each carries a UNIQUE dedup_key — the runner's idempotency key
// (athlete_id + trigger_kind + dedup_key) therefore never collapses two
// distinct requests. (Contrast scheduled/detected triggers, which pass a STABLE
// dedup_key so overlapping ticks can't double-run.)
//
// B3/B4 AUTOMATIC enqueue-on-edit is DEFERRED: there is no `plans.event_date`
// writer endpoint and no availability *edit* endpoint today (only the one-time
// `apps/web/app/api/onboarding/save/route.ts`). Per the plan's Unit 10 note, we
// do NOT invent those endpoints here; B3/B4 are covered via the explicit
// request-a-replan POST. When the event-edit / availability-edit endpoints land
// (likely with Unit 3.2's plan generation), those endpoints should call
// `sendOnDemandTrigger` with 'event_change' / 'schedule_shock' on change.
//
// This module is kept pure-ish and testable: the Inngest sender is INJECTED
// (the route passes the real client's `send`), so the mapping + payload shape
// can be unit-tested with a fake.

import crypto from "node:crypto";

import { ADAPTIVE_RUN_EVENT } from "@/inngest/functions/adaptive-run";
import type { ProposalScope, TriggerKind } from "@da2/shared";

// The on-demand trigger kinds the request-a-replan action accepts. A subset of
// the full TriggerKind vocabulary (scheduled/detected kinds aren't requestable).
export type OnDemandTriggerKind =
  | "manual" // R11
  | "schedule_shock" // B3
  | "event_change" // B4
  | "workout_swap"; // B7

// Compile-time guarantee that every on-demand kind is a valid TriggerKind.
const _assertOnDemandIsTriggerKind: Record<OnDemandTriggerKind, TriggerKind> = {
  manual: "manual",
  schedule_shock: "schedule_shock",
  event_change: "event_change",
  workout_swap: "workout_swap",
};
void _assertOnDemandIsTriggerKind;

/**
 * Map an on-demand trigger kind to its proposal scope.
 *
 * Only the single-workout swap (B7) is workout-scoped (and thus exempt from the
 * one-open-plan-proposal invariant); manual / schedule-shock / event-change all
 * reshape the plan and are plan-scoped.
 */
export function scopeForTrigger(kind: OnDemandTriggerKind): ProposalScope {
  return kind === "workout_swap" ? "workout" : "plan";
}

// The ADAPTIVE_RUN_EVENT payload this module produces. Mirrors the
// EventDataSchema shape in adaptive-run.ts.
export interface AdaptiveRunEventPayload {
  name: typeof ADAPTIVE_RUN_EVENT;
  data: {
    athlete_id: string;
    trigger_kind: OnDemandTriggerKind;
    scope: ProposalScope;
    dedup_key: string;
  };
}

export interface OnDemandTriggerRequest {
  /** The athlete whose plan/workout the engine should act on. */
  athleteId: string;
  /** Which on-demand trigger fired. */
  triggerKind: OnDemandTriggerKind;
  /**
   * Optional override for the unique dedup key (tests inject a deterministic
   * value). Defaults to a fresh UUID so the run is NEVER idempotency-deduped.
   */
  dedupKey?: string;
}

/**
 * Build the ADAPTIVE_RUN_EVENT payload for an on-demand request. Pure: no I/O,
 * no client. Scope is derived from the trigger kind; the dedup_key is unique
 * (a fresh UUID) unless explicitly provided so on-demand runs always execute.
 */
export function buildOnDemandEvent(
  req: OnDemandTriggerRequest,
): AdaptiveRunEventPayload {
  return {
    name: ADAPTIVE_RUN_EVENT,
    data: {
      athlete_id: req.athleteId,
      trigger_kind: req.triggerKind,
      scope: scopeForTrigger(req.triggerKind),
      dedup_key: req.dedupKey ?? crypto.randomUUID(),
    },
  };
}

// The minimal shape of the Inngest sender we depend on. The real
// `inngest.send` accepts a single event or an array; we send one. Injecting
// just this signature keeps the helper testable without importing the client.
export type InngestSend = (payload: AdaptiveRunEventPayload) => Promise<unknown>;

/**
 * Enqueue an on-demand adaptive run. The sender is injected so the route can
 * pass `inngest.send` (bound) and tests can pass a fake.
 *
 * Returns the payload that was sent (handy for assertions / structured logs).
 * Throws if the sender throws — the route decides the best-effort posture
 * (Unit 10: enqueue failure still returns 202, logged).
 */
export async function sendOnDemandTrigger(
  send: InngestSend,
  req: OnDemandTriggerRequest,
): Promise<AdaptiveRunEventPayload> {
  const payload = buildOnDemandEvent(req);
  await send(payload);
  return payload;
}
