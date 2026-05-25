import "server-only";

// Context gathering for the AI adaptive engine.
//
// `gatherContext` reads the inputs the proposer + validator need — the active
// plan, the athlete's completed workouts (load source), the athlete profile,
// and the targeted planned workouts — and snapshots the staleness baselines the
// proposal is persisted against:
//   - plan_id + event_date (-> event_date_snapshot; NULL-safe so add/cancel is
//     caught at apply via `IS DISTINCT FROM`)
//   - per-op baseline {version, status} from the targeted planned_workouts row
//   - earliest_affected_date (the min scheduled date the proposal can touch),
//     for the expiry sweeper.
//
// Inputs are gathered with `Promise.allSettled` (NOT Promise.all) so one slow /
// failed read doesn't abort the whole gather — partial-failure isolation per the
// strava-workout-enrichment learning. A missing active plan is fatal (nothing to
// re-plan); a missing profile or empty completed history is tolerated (the load
// proxy degrades to a conservative cold start).
//
// SECURITY: uses the service-role admin client (crons / Inngest run without a
// user JWT). EVERY read filters by athlete_id explicitly — RLS is bypassed.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EditBaseline, EditOp, PlannedWorkoutStatus } from "@da2/shared";

import {
  buildLoadSeries,
  type LoadState,
  type LoadWorkoutInput,
} from "@/training-load/load-series";
import type { ValidatablePlannedWorkout } from "@/training-load/invariants";

// --- Shapes -----------------------------------------------------------------

/** The minimal active-plan view the engine snapshots. */
export interface PlanSnapshot {
  id: string;
  /** "YYYY-MM-DD" or null for a no-date plan. */
  event_date: string | null;
}

/** A targeted planned-workout row in the validator's structural view. */
export type ContextPlannedWorkout = ValidatablePlannedWorkout & {
  /** Monotonic row-version (the staleness baseline). */
  version: number;
};

/**
 * Everything the proposer + validator + persist layer need, with the staleness
 * baselines already snapshotted.
 */
export interface PlanContext {
  athleteId: string;
  /** The active plan snapshot (plan_id + event_date). */
  plan: PlanSnapshot;
  /** Existing non-deleted planned workouts (validator's volume + protection source). */
  plannedWorkouts: ContextPlannedWorkout[];
  /** Completed-workout history feeding the load proxy. */
  completedWorkouts: LoadWorkoutInput[];
  /** CTL/ATL/TSB load state derived from completedWorkouts. */
  loadState: LoadState;
  /** Reference "today" ("YYYY-MM-DD") for ramp / recent-edit windows. */
  asOf: string;
  /** Athlete profile manual fields (weekly hours, target event), best-effort. */
  profile: Record<string, unknown> | null;
}

export class NoActivePlanError extends Error {
  constructor(athleteId: string) {
    super(`gatherContext: no active non-deleted plan for athlete ${athleteId}`);
    this.name = "NoActivePlanError";
  }
}

// --- Gather -----------------------------------------------------------------

export interface GatherContextArgs {
  admin: SupabaseClient;
  athleteId: string;
  /** "today" as "YYYY-MM-DD" (athlete-local day, resolved by the caller). */
  asOf: string;
}

/**
 * Gather + snapshot the adaptive context for an athlete. Throws
 * NoActivePlanError when there is nothing to re-plan; tolerates a missing
 * profile / empty load history.
 */
export async function gatherContext(args: GatherContextArgs): Promise<PlanContext> {
  const { admin, athleteId, asOf } = args;

  // Partial-failure isolation: gather independent reads concurrently but never
  // let one rejection abort the others. A failed plan read IS fatal (handled
  // below); failed profile / completed reads degrade gracefully.
  const [planRes, plannedRes, completedRes, profileRes] = await Promise.allSettled([
    // service-role: explicit user filter required
    admin
      .from("plans")
      .select("id, event_date")
      .eq("athlete_id", athleteId)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle(),
    // service-role: explicit user filter required
    admin
      .from("planned_workouts")
      .select(
        "id, scheduled_date, sport, structure, planned_load, status, version, edited_by_kind, edited_at"
      )
      .eq("athlete_id", athleteId)
      .is("deleted_at", null),
    // service-role: explicit user filter required
    admin
      .from("completed_workouts")
      .select("started_at, duration_s, summary_stats")
      .eq("athlete_id", athleteId)
      .is("deleted_at", null),
    // service-role: explicit user filter required
    admin
      .from("athlete_profiles")
      .select("manual_fields")
      .eq("user_id", athleteId)
      .maybeSingle(),
  ]);

  // Active plan — fatal if absent or the read failed.
  if (planRes.status !== "fulfilled" || planRes.value.error) {
    throw new Error(
      `gatherContext: plan read failed for ${athleteId}: ${
        planRes.status === "fulfilled"
          ? planRes.value.error?.message
          : String((planRes as PromiseRejectedResult).reason)
      }`
    );
  }
  const planRow = planRes.value.data as { id: string; event_date: string | null } | null;
  if (!planRow) throw new NoActivePlanError(athleteId);

  // Planned workouts — fatal if the read errored (we'd validate against nothing).
  if (plannedRes.status !== "fulfilled" || plannedRes.value.error) {
    throw new Error(
      `gatherContext: planned_workouts read failed for ${athleteId}: ${
        plannedRes.status === "fulfilled"
          ? plannedRes.value.error?.message
          : String((plannedRes as PromiseRejectedResult).reason)
      }`
    );
  }
  const plannedWorkouts = toContextPlannedWorkouts(
    (plannedRes.value.data ?? []) as RawPlannedRow[]
  );

  // Completed history — tolerated. On failure, an empty series => conservative
  // cold-start load state.
  const completedWorkouts: LoadWorkoutInput[] =
    completedRes.status === "fulfilled" && !completedRes.value.error
      ? ((completedRes.value.data ?? []) as RawCompletedRow[]).map((r) => ({
          started_at: r.started_at,
          duration_s: r.duration_s,
          summary_stats: r.summary_stats,
        }))
      : [];

  // Profile — tolerated; best-effort framing input only.
  const profile: Record<string, unknown> | null =
    profileRes.status === "fulfilled" && !profileRes.value.error
      ? ((profileRes.value.data as { manual_fields?: Record<string, unknown> } | null)
          ?.manual_fields ?? null)
      : null;

  const loadState = buildLoadSeries(completedWorkouts, { asOf });

  return {
    athleteId,
    plan: { id: planRow.id, event_date: planRow.event_date },
    plannedWorkouts,
    completedWorkouts,
    loadState,
    asOf,
    profile,
  };
}

// --- Snapshot helpers -------------------------------------------------------

interface RawPlannedRow {
  id: string;
  scheduled_date: string;
  sport: string;
  structure: Record<string, unknown> | null;
  planned_load: number | null;
  status: string;
  version: number;
  edited_by_kind: "athlete" | "coach" | "ai_review" | null;
  edited_at: string | null;
}

interface RawCompletedRow {
  started_at: string;
  duration_s: number | null;
  summary_stats: Record<string, unknown> | null | undefined;
}

/** Read a numeric structure-subset field (duration_s / load) defensively. */
function readStructureNumber(
  structure: Record<string, unknown> | null,
  key: string
): number | null {
  if (!structure) return null;
  const v = structure[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toContextPlannedWorkouts(rows: RawPlannedRow[]): ContextPlannedWorkout[] {
  return rows.map((r) => {
    // Volume baseline reads duration_s from the frozen structure subset; load
    // prefers structure.load, falling back to the planned_load column.
    const durationS = readStructureNumber(r.structure, "duration_s");
    const structureLoad = readStructureNumber(r.structure, "load");
    return {
      id: r.id,
      scheduled_date: r.scheduled_date,
      duration_s: durationS,
      load: structureLoad ?? r.planned_load,
      status: r.status,
      edited_by_kind: r.edited_by_kind,
      edited_at: r.edited_at,
      version: r.version,
    };
  });
}

/**
 * Per-op staleness baseline {version, status} from the targeted row. NULL for
 * `insert` ops (no pre-existing row — apply checks ISO-week composition instead).
 */
export function baselineForOp(
  op: EditOp,
  plannedWorkouts: ContextPlannedWorkout[]
): EditBaseline | null {
  if (op.kind === "insert") return null;
  const target = plannedWorkouts.find((w) => w.id === op.workout_id);
  if (!target) return null;
  return {
    version: target.version,
    status: target.status as PlannedWorkoutStatus,
  };
}

/**
 * The earliest scheduled date any op in the set can affect — the proposal's
 * `earliest_affected_date` (drives expiry). For ops targeting an existing row we
 * use that row's date; for `move`/`insert` we use the destination date; the min
 * across all is returned (null when no op resolves to a date).
 */
export function earliestAffectedDate(
  ops: EditOp[],
  plannedWorkouts: ContextPlannedWorkout[]
): string | null {
  const dateById = new Map<string, string>();
  for (const w of plannedWorkouts) dateById.set(w.id, w.scheduled_date);

  let earliest: string | null = null;
  for (const op of ops) {
    const dates: string[] = [];
    switch (op.kind) {
      case "move":
        dates.push(op.to_date);
        if (dateById.has(op.workout_id)) dates.push(dateById.get(op.workout_id)!);
        break;
      case "insert":
        dates.push(op.on_date);
        break;
      case "modify":
      case "skip":
      case "delete": {
        const d = dateById.get(op.workout_id);
        if (d) dates.push(d);
        break;
      }
    }
    for (const d of dates) {
      if (earliest == null || d < earliest) earliest = d;
    }
  }
  return earliest;
}
