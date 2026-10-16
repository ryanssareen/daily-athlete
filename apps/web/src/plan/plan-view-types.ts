// Shared input shapes for the pure Plan tab composers (plan-story,
// plan-results, plan-forecast). No React, no I/O. buildPlanView (plan-view.ts)
// maps database rows into these.

/** A planned_workouts row that counts toward the plan: planned, moved or
 * completed, at its stored scheduled_date. Skipped rows are excluded. */
export interface CountedSession {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  sport: string;
  status: "planned" | "moved" | "completed";
  structure: Record<string, unknown> | null;
  /** The planned_workouts.planned_load column (structure.load wins when present). */
  plannedLoadColumn: number | null;
  rationale: string | null;
}

/** The matched completed workout fields the verdict comparison reads. */
export interface MatchedCompleted {
  duration_s: number | null;
  distance_m: number | null;
  sport: string;
  summary_stats: Record<string, unknown>;
}
