import "server-only";

// Node-side accept/apply path for an AI adaptive proposal (plan Unit 6).
//
// The expensive CTL/ATL/TSB re-validation (validateOps, Unit 4) is pure TS and
// CANNOT run inside the SQL apply RPC. So it runs HERE, in the Node layer,
// IMMEDIATELY BEFORE invoking apply_weekly_review. We:
//
//   1. Build the CURRENT load context (current planned workouts + completed
//      workouts) and re-run validateOps over ONLY the accepted ops. Unrelated
//      workouts can complete between generation and accept, shifting load, so a
//      proposal that was safe at propose time may breach an invariant now.
//   2. Apply the COUPLED-TRIGGER RULE: a coupled proposal (deload / progression
//      / reshape / weekly / etc. -- everything except B7 workout_swap) is an
//      all-or-nothing coordinated set. If re-validation drops ANY accepted op,
//      we DO NOT partial-apply -- we mark the proposal `superseded` and return a
//      `{ outcome: 'superseded' }` result so the engine can re-enqueue. For
//      INDEPENDENT triggers (workout_swap) we pass the surviving op-ids through
//      and let the RPC partial-apply.
//   3. Call apply_weekly_review with the surviving accepted op-ids; the RPC then
//      takes FOR UPDATE locks on the active plan + affected workouts so no new
//      completions/edits land between this re-validation and commit, and owns
//      the cheap transaction-local checks (per-op version compare,
//      completed/matched refusal, plan-context IS DISTINCT FROM, soft-delete,
//      ai_review attribution, workout_edits append, final status transition).
//
// The route handler is the SOLE authz gate; this module is invoked only after
// the caller has been verified as the proposal's recipient. It uses the
// service-role admin client and ALWAYS filters by the proposal's athlete_id.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EditOp,
  EditOpResult,
  ProposedEdit,
  TriggerKind,
  WeeklyReviewRow,
} from "@da2/shared";

import { createAdminClient } from "@/db/admin";
import { isCoupled } from "@/ai/adaptive/precedence";
import {
  buildLoadSeries,
  validateOps,
  type LoadState,
  type LoadWorkoutInput,
  type ValidatableOp,
  type ValidatablePlan,
  type ValidatablePlannedWorkout,
  type ValidateContext,
} from "@/training-load";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

/** Per-op result the RPC reports (mirrors apply_weekly_review's jsonb). */
export interface ApplyOpResult {
  op_id: string;
  outcome: string;
  detail?: string;
}

/** The jsonb apply_weekly_review returns, typed for the Node caller. */
export interface ApplyResult {
  /** Final proposal status after the call. */
  status: string;
  /** True iff the proposal was aborted to `superseded`. */
  superseded: boolean;
  /** Per-op outcomes (applied | skipped_stale | refused_completed | ...). */
  results: ApplyOpResult[];
  /** Set by the RPC when the proposal was already decided (idempotent guard). */
  already_decided?: boolean;
}

// ---------------------------------------------------------------------------
// Op mapping: ProposedEdit (op + baseline) -> ValidatableOp (Unit 4 shape)
// ---------------------------------------------------------------------------

/**
 * Project a stored EditOp + the current target row onto the minimal structural
 * op the validator reads. `target_date` is the day the workout lands on AFTER
 * the op (new date for move/insert; the existing row's date otherwise); load /
 * duration come from the op's changes (or the existing row for unchanged ops).
 */
function toValidatableOp(
  op: EditOp,
  targetRow: ValidatablePlannedWorkout | undefined
): ValidatableOp {
  switch (op.kind) {
    case "move":
      return {
        op_id: op.op_id,
        kind: "move",
        workout_id: op.workout_id,
        target_date: op.to_date,
        duration_s: targetRow?.duration_s ?? null,
        load: targetRow?.load ?? null,
        reason: op.reason,
      };
    case "modify":
      return {
        op_id: op.op_id,
        kind: "modify",
        workout_id: op.workout_id,
        target_date: targetRow?.scheduled_date ?? "",
        duration_s: op.changes.duration_s ?? targetRow?.duration_s ?? null,
        load: op.changes.load ?? targetRow?.load ?? null,
        reason: op.reason,
      };
    case "skip":
      return {
        op_id: op.op_id,
        kind: "skip",
        workout_id: op.workout_id,
        target_date: targetRow?.scheduled_date ?? "",
        reason: op.reason,
      };
    case "delete":
      return {
        op_id: op.op_id,
        kind: "delete",
        workout_id: op.workout_id,
        target_date: targetRow?.scheduled_date ?? "",
        reason: op.reason,
      };
    case "insert":
      return {
        op_id: op.op_id,
        kind: "insert",
        workout_id: null,
        target_date: op.on_date,
        duration_s: op.structure.duration_s ?? null,
        load: op.structure.load ?? null,
        sport: op.sport,
        reason: op.reason,
      };
  }
}

// ---------------------------------------------------------------------------
// Load-context gathering (service-role; explicit athlete filter)
// ---------------------------------------------------------------------------

/**
 * Read the current planned-workout context the validator needs (weekly-volume
 * baseline + coach-protection source). Pulls plannable fields from `structure`
 * (duration_s) and the `planned_load` column.
 *
 * service-role: explicit athlete filter required.
 */
async function fetchPlannedWorkouts(
  admin: SupabaseClient,
  athleteId: string
): Promise<ValidatablePlannedWorkout[]> {
  const { data, error } = await admin
    .from("planned_workouts")
    .select(
      "id, scheduled_date, structure, planned_load, status, edited_by_kind, edited_at"
    )
    .eq("athlete_id", athleteId)
    .is("deleted_at", null);

  if (error) throw new Error(`fetchPlannedWorkouts failed: ${error.message}`);

  return (data ?? []).map((r): ValidatablePlannedWorkout => {
    const structure = (r.structure ?? {}) as Record<string, unknown>;
    const structDuration =
      typeof structure.duration_s === "number" ? structure.duration_s : null;
    const plannedLoad =
      typeof r.planned_load === "number" ? r.planned_load : null;
    return {
      id: r.id as string,
      scheduled_date: r.scheduled_date as string,
      duration_s: structDuration,
      load: plannedLoad,
      status: r.status as string,
      edited_by_kind: (r.edited_by_kind ??
        null) as ValidatablePlannedWorkout["edited_by_kind"],
      edited_at: (r.edited_at ?? null) as string | null,
    };
  });
}

/**
 * Read the athlete's completed workouts so projected CTL-ramp / TSB can be
 * recomputed WITH the ops' added load against CURRENT load.
 *
 * service-role: explicit athlete filter required.
 */
async function fetchCompletedWorkouts(
  admin: SupabaseClient,
  athleteId: string
): Promise<LoadWorkoutInput[]> {
  const { data, error } = await admin
    .from("completed_workouts")
    .select("started_at, duration_s, summary_stats")
    .eq("athlete_id", athleteId)
    .is("deleted_at", null);

  if (error) throw new Error(`fetchCompletedWorkouts failed: ${error.message}`);

  return (data ?? []).map((r): LoadWorkoutInput => ({
    started_at: r.started_at as string,
    duration_s: (r.duration_s ?? null) as number | null,
    summary_stats: (r.summary_stats ?? null) as Record<string, unknown> | null,
  }));
}

/** "Today" as YYYY-MM-DD (UTC). The validator's recent-edit + ramp reference. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// reValidateAndApply
// ---------------------------------------------------------------------------

/**
 * Re-validate the accepted ops against CURRENT load, then atomically apply the
 * survivors via the apply_weekly_review RPC.
 *
 * @param reviewRow      the proposed weekly_reviews row (sole op source).
 * @param acceptedOpIds  op-ids the recipient chose to accept (the modify subset).
 * @param actorUserId    the verified accepter (stamped as the ai_review editor).
 */
export async function reValidateAndApply(
  reviewRow: WeeklyReviewRow,
  acceptedOpIds: string[],
  actorUserId: string,
  deps: { admin?: SupabaseClient } = {}
): Promise<ApplyResult> {
  const admin = deps.admin ?? createAdminClient();

  // Restrict to the accepted, plan-applicable ops. Deselected ops never apply.
  const acceptedSet = new Set(acceptedOpIds);
  const acceptedEdits: ProposedEdit[] = reviewRow.proposed_changes.filter((pe) =>
    acceptedSet.has(pe.op.op_id)
  );

  // Nothing accepted -> nothing to apply. Still call the RPC so the proposal's
  // status transition (partially_accepted with no applied ops) is owned by the
  // single authoritative writer rather than special-cased here.
  // (acceptedEdits may be empty; the RPC handles a zero-op accept.)

  // 1. Build current load context (Node) and re-run validateOps.
  const [plannedWorkouts, completedWorkouts] = await Promise.all([
    fetchPlannedWorkouts(admin, reviewRow.athlete_id),
    fetchCompletedWorkouts(admin, reviewRow.athlete_id),
  ]);

  const byId = new Map<string, ValidatablePlannedWorkout>();
  for (const w of plannedWorkouts) byId.set(w.id, w);

  const asOf = todayKey();
  const loadState: LoadState = buildLoadSeries(completedWorkouts, { asOf });

  const validatableOps: ValidatableOp[] = acceptedEdits.map((pe) =>
    toValidatableOp(
      pe.op,
      pe.op.kind === "insert" ? undefined : byId.get(opWorkoutId(pe.op) ?? "")
    )
  );

  const plan: ValidatablePlan = { event_date: reviewRow.event_date_snapshot };
  const ctx: ValidateContext = {
    plannedWorkouts,
    loadState,
    completedWorkouts,
    asOf,
  };

  const { valid, dropped } = validateOps(plan, validatableOps, ctx);

  // 2. Coupled-trigger rule: any dropped op aborts the WHOLE coupled proposal.
  if (dropped.length > 0 && isCoupled(reviewRow.trigger_kind as TriggerKind)) {
    await admin
      .from("weekly_reviews")
      .update({ status: "superseded", decided_at: new Date().toISOString() })
      // service-role: explicit athlete filter required
      .eq("id", reviewRow.id)
      .eq("athlete_id", reviewRow.athlete_id)
      .eq("status", "proposed");

    const results: ApplyOpResult[] = dropped.map((d) => ({
      op_id: d.op.op_id,
      outcome: "superseded",
      detail: `re-validation dropped op (${d.reason}); coupled proposal aborted`,
    }));
    return { status: "superseded", superseded: true, results };
  }

  // For INDEPENDENT triggers, surviving op-ids pass through; dropped ones are
  // reported as dropped_invalid alongside the RPC's per-op outcomes.
  const survivingOpIds = valid.map((o) => o.op_id);

  // 3. Apply the survivors atomically via the SQL RPC.
  const { data, error } = await admin.rpc("apply_weekly_review", {
    p_review_id: reviewRow.id,
    p_accepted_op_ids: survivingOpIds,
    p_actor_user_id: actorUserId,
  });

  if (error) {
    throw new Error(`apply_weekly_review rpc failed: ${error.message}`);
  }

  const rpcResult = (data ?? {}) as {
    status?: string;
    superseded?: boolean;
    results?: ApplyOpResult[];
    already_decided?: boolean;
  };

  const results: ApplyOpResult[] = [...(rpcResult.results ?? [])];
  // Surface independent-trigger re-validation drops to the caller, too.
  for (const d of dropped) {
    results.push({
      op_id: d.op.op_id,
      outcome: "dropped_invalid",
      detail: d.reason,
    });
  }

  return {
    status: rpcResult.status ?? "proposed",
    superseded: rpcResult.superseded ?? false,
    results,
    ...(rpcResult.already_decided ? { already_decided: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** The target workout id of an existing-row op (null for insert). */
function opWorkoutId(op: EditOp): string | null {
  return op.kind === "insert" ? null : op.workout_id;
}

// `EditOpResult` is the canonical shared shape; ApplyOpResult is structurally a
// superset (it allows the engine-internal `superseded`/`dropped_invalid`
// outcomes). Re-export the type alias so route handlers can narrow when needed.
export type { EditOpResult };
