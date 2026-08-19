import "server-only";

// Stable content hash for a period review's material inputs (U4, KTD3).
//
// This is the whole of the cache-invalidation policy. A narrative is served
// from the cache when the fingerprint matches and marked stale when it does
// not, so what this file hashes IS the definition of "material change" (R6).
//
// WHAT IS HASHED, and why it is built as a fresh literal rather than by
// subtracting fields from the context: `toFingerprintInput` names exactly the
// fields below and nothing else, so a field OUTSIDE the list is structurally
// incapable of perturbing the hash. There is no code path here that reads
// `context.profile`, a workout's `started_at`, or a Strava id -- not because
// we remembered to exclude them, but because nothing references them. That is
// what makes AE4 ("a non-material field changes -> cached narrative served,
// zero LLM calls") hold by construction rather than by reviewer vigilance.
//
//   Per completed workout (the same material projection the per-workout
//   report's KTD4 uses, so the two surfaces agree on what "material" means):
//     id, distance_m, duration_s, sport, summary_stats,
//     matched_planned_workout_id
//   The prescribed set:
//     each planned workout's id, sport, scheduled_date, planned_load, structure
//   Period-level:
//     kind, periodKey, plan_goal, plan_event_date
//
// WHY THE WORKOUT SET ITSELF IS MATERIAL. A workout being added to or removed
// from the period changes the review's every number, so the id list is part of
// the hash. This is also how a SOFT-DELETED workout invalidates the review:
// the row drops out of the context read, drops out of this projection, and the
// hash moves -- which is why migration 0029 deliberately has no soft-delete
// cascade onto period_reviews. The fingerprint already covers it, and
// tombstoning a whole retrospective because one session was deleted would
// throw away a still-valid report.
//
// WHY plan_goal / plan_event_date ARE HASHED. Both reach the narration prompt,
// and the takeaway is written TOWARD them. An athlete who moves their event or
// changes it from a marathon to a 70.3 has invalidated the advice in every
// stored takeaway. They change rarely, so hashing them costs almost no
// spurious invalidation.
//
// WHY CTL/ATL/TSB ARE DELIBERATELY *NOT* HASHED. They are EWMAs over the
// athlete's whole history; logging any new activity perturbs them. Hashing
// them would mark every past review stale the moment the athlete finishes
// their next ride, turning `stale` from a signal into permanent noise and
// inviting an unbounded regeneration bill. They were true as of the period the
// report describes; a historical snapshot going out of date is not the report
// going wrong. Same deliberate, permanent exclusion the per-workout
// fingerprint makes, for the same reason.

import { createHash } from "node:crypto";

import { canonicalize } from "@/ai/reports/fingerprint";

import type { AggregateCompletedWorkout, AggregatePlannedWorkout } from "./aggregate";
import type { PeriodContext } from "./context";

/** The material projection of one completed workout. Mirrors the per-workout
 * report's KTD4 field list, minus the fields that only make sense for a single
 * session (superseded_by_id is covered here by the row's presence or absence
 * in the period set). */
interface CompletedProjection {
  id: string;
  distance_m: number | null;
  duration_s: number | null;
  sport: string;
  summary_stats: Record<string, unknown>;
  matched_planned_workout_id: string | null;
}

/** The material projection of one prescribed workout. */
interface PlannedProjection {
  id: string;
  sport: string;
  scheduled_date: string;
  planned_load: number | null;
  structure: Record<string, unknown> | null;
}

interface FingerprintInput {
  kind: string;
  period_key: string;
  completed: CompletedProjection[];
  planned: PlannedProjection[];
  plan_goal: string | null;
  plan_event_date: string | null;
}

/** Order by id before hashing. `canonicalize` sorts object KEYS but preserves
 * ARRAY order (position is semantic for a list), so an unordered array would
 * hash differently for identical data. The context read already orders by id;
 * sorting again here means the guarantee does not depend on a caller
 * remembering to. */
function byId<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

function projectCompleted(w: AggregateCompletedWorkout): CompletedProjection {
  return {
    id: w.id,
    distance_m: w.distance_m,
    duration_s: w.duration_s,
    sport: w.sport,
    summary_stats: w.summary_stats ?? {},
    matched_planned_workout_id: w.matched_planned_workout_id,
  };
}

function projectPlanned(p: AggregatePlannedWorkout): PlannedProjection {
  return {
    id: p.id,
    sport: p.sport,
    scheduled_date: p.scheduled_date,
    planned_load: p.planned_load,
    structure: p.structure,
  };
}

function toFingerprintInput(context: PeriodContext): FingerprintInput {
  return {
    kind: context.kind,
    period_key: context.periodKey,
    completed: byId(context.completed).map(projectCompleted),
    planned: byId(context.planned).map(projectPlanned),
    plan_goal: context.plan?.goal ?? null,
    plan_event_date: context.plan?.event_date ?? null,
  };
}

/**
 * The narrative cache key (`period_reviews.input_fingerprint`).
 *
 * Pure and deterministic: two contexts equal on the material fields above
 * always produce the byte-identical fingerprint, however differently their
 * other fields differ and however differently their object keys are ordered.
 */
export function computePeriodFingerprint(context: PeriodContext): string {
  const json = JSON.stringify(canonicalize(toFingerprintInput(context)));
  return createHash("sha256").update(json).digest("hex");
}
