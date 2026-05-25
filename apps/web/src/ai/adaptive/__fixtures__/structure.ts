// Shared representative `structure`-subset fixture for the AI adaptive engine
// tests. The engine and the deterministic validator (Unit 4) only read/write a
// FROZEN subset of planned_workouts.structure with pinned units:
//   duration_s   — whole-session duration in SECONDS (integer)
//   load         — planned training load in TSS-equivalent units
//   intensity_target — tagged union (ftp_pct | zone | pace_s_per_km)
// (see packages/shared/src/edit-op.ts StructureChangeSchema).
//
// The first integration task when the real plan-generation pipeline (product
// Unit 3.2) lands is to assert its real `structure` is a SUPERSET of this
// fixture AND that a few real workouts produce the fixture-predicted TSS — a
// name-only match with differing units would compute unsafe decisions while
// tests stay green. This fixture is the contract anchor for that check.

import type {
  EditBaseline,
  IntensityTarget,
  PlannedWorkoutRow,
} from "@da2/shared";

import type { LoadWorkoutInput } from "@/training-load/load-series";

export const FIXTURE_ATHLETE_ID = "00000000-0000-0000-0000-00000000a711";
export const FIXTURE_PLAN_ID = "00000000-0000-0000-0000-0000000091a0";

// Deterministic planned-workout UUIDs the canned diffs / tests target.
export const FIXTURE_WORKOUT_IDS = {
  easyRun: "00000000-0000-0000-0000-0000000000e1",
  tempoRun: "00000000-0000-0000-0000-0000000000e2",
  longRun: "00000000-0000-0000-0000-0000000000e3",
  coachEdited: "00000000-0000-0000-0000-0000000000c0",
} as const;

const ZONE_2: IntensityTarget = { kind: "zone", value: 2 };
const ZONE_4: IntensityTarget = { kind: "zone", value: 4 };

/**
 * Build a planned_workouts row over the frozen structure subset. Defaults to a
 * planned, athlete-attributed (un-protected) easy run.
 */
export function fixturePlannedWorkout(
  over: Partial<PlannedWorkoutRow> & { id: string }
): PlannedWorkoutRow {
  return {
    athlete_id: FIXTURE_ATHLETE_ID,
    plan_id: FIXTURE_PLAN_ID,
    scheduled_date: "2026-06-01",
    sport: "run",
    structure: { duration_s: 3600, load: 50, intensity_target: ZONE_2 },
    planned_load: 50,
    status: "planned",
    rationale: null,
    edited_by_kind: "ai_review",
    edited_by_user_id: null,
    edited_at: null,
    version: 1,
    created_at: "2026-05-20T12:00:00+00:00",
    deleted_at: null,
    ...over,
  };
}

/**
 * A representative set of planned workouts: a light week (two easy runs + a
 * tempo) the engine can safely deload/modify, plus one coach-edited row that
 * must be excluded from any proposed op.
 */
export function fixturePlannedWorkouts(): PlannedWorkoutRow[] {
  return [
    fixturePlannedWorkout({
      id: FIXTURE_WORKOUT_IDS.easyRun,
      scheduled_date: "2026-06-01",
      structure: { duration_s: 3600, load: 50, intensity_target: ZONE_2 },
      planned_load: 50,
    }),
    fixturePlannedWorkout({
      id: FIXTURE_WORKOUT_IDS.tempoRun,
      scheduled_date: "2026-06-03",
      structure: { duration_s: 3600, load: 65, intensity_target: ZONE_4 },
      planned_load: 65,
      version: 2,
    }),
    fixturePlannedWorkout({
      id: FIXTURE_WORKOUT_IDS.longRun,
      scheduled_date: "2026-06-06",
      structure: { duration_s: 7200, load: 90, intensity_target: ZONE_2 },
      planned_load: 90,
      version: 3,
    }),
    // Coach-edited: validateOps must drop any op targeting this row.
    fixturePlannedWorkout({
      id: FIXTURE_WORKOUT_IDS.coachEdited,
      scheduled_date: "2026-06-04",
      structure: { duration_s: 3600, load: 60, intensity_target: ZONE_2 },
      planned_load: 60,
      edited_by_kind: "coach",
      edited_by_user_id: "00000000-0000-0000-0000-0000000c0acc",
      edited_at: "2026-05-24T09:00:00+00:00",
      version: 5,
    }),
  ];
}

/**
 * A calm, mid-block completed-workout history (steady easy runs) so load-trend
 * invariants don't dominate the structural tests. Twelve weeks of ~50 TSS/day.
 */
export function fixtureCompletedWorkouts(asOf = "2026-05-25"): LoadWorkoutInput[] {
  const out: LoadWorkoutInput[] = [];
  const start = Date.parse("2026-03-02T00:00:00Z");
  const end = Date.parse(`${asOf}T00:00:00Z`);
  for (let t = start; t <= end; t += 86_400_000) {
    out.push({
      started_at: new Date(t).toISOString().slice(0, 10),
      duration_s: 3600,
      summary_stats: { tss: 50 },
    });
  }
  return out;
}

/** Per-op baseline {version,status} for a fixture row by id. */
export function fixtureBaseline(
  workouts: PlannedWorkoutRow[],
  workoutId: string
): EditBaseline | null {
  const w = workouts.find((x) => x.id === workoutId);
  if (!w) return null;
  return { version: w.version, status: w.status };
}

/** The shared plan context the engine/tests snapshot from. */
export interface FixturePlanContext {
  athleteId: string;
  planId: string;
  eventDate: string | null;
  plannedWorkouts: PlannedWorkoutRow[];
  completedWorkouts: LoadWorkoutInput[];
}

export function fixturePlanContext(
  over: Partial<FixturePlanContext> = {}
): FixturePlanContext {
  return {
    athleteId: FIXTURE_ATHLETE_ID,
    planId: FIXTURE_PLAN_ID,
    eventDate: "2026-09-01",
    plannedWorkouts: fixturePlannedWorkouts(),
    completedWorkouts: fixtureCompletedWorkouts(),
    ...over,
  };
}
