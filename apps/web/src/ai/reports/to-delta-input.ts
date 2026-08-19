// Context -> DeltaInput adapter (Unit U6, the composition seam U4/U3
// deliberately left open -- see
// docs/plans/2026-08-18-001-feat-workout-reports-plan.md, Unit U6).
//
// `computeExecutionDelta` (Unit U3) is deliberately pure and only knows the
// narrow `DeltaInput` shape; `gatherReportContext` (Unit U4) is deliberately
// the richer, I/O-derived `ReportContext` shape. Neither module imports the
// other. This is the glue that projects one into the other, owned by U6
// because it is the first unit that needs both.
//
// `MatchedPlannedWorkout.structure` (U4) is the RAW `planned_workouts.structure`
// JSONB -- exactly what fingerprint.ts (KTD4) needs to hash verbatim. It is
// NOT the shape `DeltaPlannedStructureInput` (U3) wants; U4 already derived
// `duration_s` / `load` / `intensity_target` defensively off that raw JSONB
// (see context.ts's readStructureNumber/readStructureIntensityTarget), so
// this adapter reads those derived accessors rather than re-parsing the raw
// structure itself.

import type { DeltaInput } from "./delta";
import type { ReportContext } from "./context";

/** Project a gathered `ReportContext` into the narrow `DeltaInput` shape
 * `computeExecutionDelta` (Unit U3) reads. Pure -- no I/O. */
export function toDeltaInput(context: ReportContext): DeltaInput {
  const completed = {
    duration_s: context.completedWorkout.duration_s,
    distance_m: context.completedWorkout.distance_m,
    sport: context.completedWorkout.sport,
    summary_stats: context.completedWorkout.summary_stats,
  };

  if (!context.match) {
    return { matched: false, completed };
  }

  return {
    matched: true,
    completed,
    planned: {
      sport: context.match.sport,
      planned_load: context.match.planned_load,
      structure: {
        duration_s: context.match.duration_s ?? undefined,
        load: context.match.load ?? undefined,
        intensity_target: context.match.intensity_target ?? undefined,
      },
    },
  };
}
