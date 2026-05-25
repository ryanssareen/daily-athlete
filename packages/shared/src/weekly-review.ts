// Mirror of public.weekly_reviews from
// supabase/migrations/0019_weekly_reviews_and_workout_edits.sql. One AI adaptive
// proposal: a validated set of edit operations the athlete (or, for coached
// athletes, the coach) accepts / modifies / rejects -- never silently applied
// (R10). See docs/plans/2026-05-25-001-feat-ai-adaptive-plans-engine-plan.md.
//
// SQL invariants enforced at the DB layer (NOT Zod refinements here):
// - status is written ONLY by the apply RPC (no client self-UPDATE policy).
// - One open plan-scoped proposal per athlete (partial unique index).

import { z } from "zod";

import { NARRATIVE_MAX_LENGTH, ProposedEditSchema } from "./edit-op";

// Matches the SQL CHECK on weekly_reviews.status.
export const WeeklyReviewStatusSchema = z.enum([
  "proposed",
  "accepted",
  "partially_accepted",
  "rejected",
  "superseded",
  "expired",
  "no_changes",
]);
export type WeeklyReviewStatus = z.infer<typeof WeeklyReviewStatusSchema>;

// Matches the SQL CHECK on weekly_reviews.trigger_kind. Records which trigger
// (brainstorm category B) produced the proposal. `fatigue_deload` (B5) and
// `progression_bump` (B6) are deferred from v1 but kept in the vocabulary so
// the schema and precedence accommodate them additively.
export const TriggerKindSchema = z.enum([
  "weekly", // B1
  "missed_block", // B2
  "schedule_shock", // B3
  "event_change", // B4
  "fatigue_deload", // B5 (deferred)
  "progression_bump", // B6 (deferred)
  "workout_swap", // B7
  "manual", // R11
]);
export type TriggerKind = z.infer<typeof TriggerKindSchema>;

// plan-scoped proposals are subject to the one-open invariant; workout-scoped
// (B7) and manual proposals are exempt.
export const ProposalScopeSchema = z.enum(["plan", "workout"]);
export type ProposalScope = z.infer<typeof ProposalScopeSchema>;

// Where the proposal routes: solo athletes self-serve; coached athletes'
// proposals route to the coach (the accepter on the athlete's behalf).
export const ProposalRecipientSchema = z.enum(["athlete", "coach"]);
export type ProposalRecipient = z.infer<typeof ProposalRecipientSchema>;

// SQL DATE columns; PostgREST returns "YYYY-MM-DD" strings. Timestamps use
// .datetime({ offset: true }) per the packages/shared convention.
export const WeeklyReviewRowSchema = z.object({
  id: z.string().uuid(),
  athlete_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  trigger_kind: TriggerKindSchema,
  scope: ProposalScopeSchema,
  recipient: ProposalRecipientSchema,
  status: WeeklyReviewStatusSchema,
  // The validated op list with per-op staleness baselines.
  proposed_changes: z.array(ProposedEditSchema),
  // Untrusted LLM string -> length-capped; rendered as plain text by the UI.
  narrative: z.string().max(NARRATIVE_MAX_LENGTH).nullable(),
  event_date_snapshot: z.string().nullable(),
  earliest_affected_date: z.string().nullable(),
  generated_at: z.string().datetime({ offset: true }),
  decided_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  deleted_at: z.string().datetime({ offset: true }).nullable(),
});
export type WeeklyReviewRow = z.infer<typeof WeeklyReviewRowSchema>;
