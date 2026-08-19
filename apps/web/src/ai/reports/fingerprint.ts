import "server-only";

// Stable content hash for a workout report's material inputs
// (docs/plans/2026-08-18-001-feat-workout-reports-plan.md, KTD4/Unit U4).
//
// `computeFingerprint` hashes ONLY the ten fields KTD4 names as material:
// distance_m, duration_s, sport, summary_stats, matched_planned_workout_id,
// planned_structure, planned_load, superseded_by_id, plan_goal,
// plan_event_date. This is what makes R9 ("a cached narrative is invalidated
// only by a MATERIAL change") and AE4 ("the athlete edits only a note field
// -> fingerprint unchanged, cached narrative served, zero LLM calls") hold BY
// CONSTRUCTION rather than by caller discipline: `toFingerprintInput` below
// builds a fresh literal object naming exactly those ten keys and nothing
// else. It is handed the full ReportContext but can only ever read those ten
// paths off it -- a field outside this list (e.g.
// `context.completedWorkout.started_at`, a workout note, `context.profile`)
// is structurally incapable of perturbing the hash, because there is no code
// path here that ever touches it.
//
// WHY plan_goal / plan_event_date ARE HASHED (KTD4 revision, resolving the
// plan-level gap the U6 review found). Both reach the narration prompt
// verbatim (fact-sheet.ts's `goal`/`eventDate` -> narrate.ts's prompt
// sections), and the narrative's whole forward-looking half -- the takeaway
// -- is written *toward* them. An athlete who changes their event from a
// marathon to a 70.3, or moves their event date, has invalidated the advice
// in every stored takeaway. Leaving them out of the hash left those reports
// permanently narrating a goal that no longer exists with `stale: false`,
// which is exactly the failure mode `stale` exists to prevent. Both change
// rarely (an athlete sets an event once a season), so hashing them costs
// almost no spurious invalidation.
//
// WHY recentLoad IS DELIBERATELY *NOT* HASHED, though it also reaches the
// prompt. CTL/ATL/TSB are an EWMA over the athlete's whole training history
// as of this workout's day; logging ANY new activity perturbs them. Hashing
// them -- even coarsely rounded -- would mark every past report in the
// athlete's account stale the moment they finish their next ride, turning
// `stale` from a meaningful signal into permanent background noise and
// inviting an unbounded regeneration bill. The three scalars are also used
// by the narrator as context colour ("you were carrying fatigue"), not as a
// claim about the workout being debriefed, and they were TRUE as of the day
// the report describes. A historical snapshot going out of date is not the
// report going wrong. Documented here as a deliberate, permanent exclusion,
// not an oversight.
//
// Do NOT "hash the whole context and hope nothing extra leaks in" -- that
// was explicitly rejected (see the U4 spec: "Do not hash the whole row and
// subtract"). Do not add an eleventh field here without updating KTD4 and
// this comment together.

import { createHash } from "node:crypto";

import type { ReportContext } from "./context";

/** The exact material-field projection KTD4 defines. The key order written
 * here is documentation only -- `canonicalize` sorts keys before hashing, so
 * this object's literal insertion order has no bearing on the resulting
 * hash (see fingerprint.test.ts's "insertion order" stability assertion). */
interface FingerprintInput {
  distance_m: number | null;
  duration_s: number | null;
  sport: string;
  summary_stats: Record<string, unknown>;
  matched_planned_workout_id: string | null;
  planned_structure: Record<string, unknown> | null;
  planned_load: number | null;
  superseded_by_id: string | null;
  plan_goal: string | null;
  plan_event_date: string | null;
}

function toFingerprintInput(context: ReportContext): FingerprintInput {
  return {
    distance_m: context.completedWorkout.distance_m,
    duration_s: context.completedWorkout.duration_s,
    sport: context.completedWorkout.sport,
    summary_stats: context.completedWorkout.summary_stats,
    matched_planned_workout_id: context.match?.id ?? null,
    planned_structure: context.match?.structure ?? null,
    planned_load: context.match?.planned_load ?? null,
    superseded_by_id: context.completedWorkout.superseded_by_id,
    plan_goal: context.plan?.goal ?? null,
    plan_event_date: context.plan?.event_date ?? null,
  };
}

/**
 * Recursively sort object keys (arrays keep their element ORDER -- position
 * is semantic for a list, e.g. anything array-shaped nested in
 * `summary_stats`) so `JSON.stringify` output never varies with a caller's
 * property-insertion order. This is what the plan's "serialize canonically"
 * requirement means concretely: two structurally-equal-but-differently-
 * ordered objects must canonicalize to identical JSON.
 *
 * Exported so fingerprint.test.ts can pin the property directly; it is not
 * otherwise part of the module's intended public contract (only
 * `computeFingerprint` is).
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Deterministic sha256 hex digest of the canonically-serialized value. */
function hashCanonical(value: unknown): string {
  const json = JSON.stringify(canonicalize(value));
  return createHash("sha256").update(json).digest("hex");
}

/**
 * The narrative cache key (`workout_reports.input_fingerprint`). Hashes ONLY
 * the KTD4 material fields -- see the module header. Pure and deterministic:
 * two contexts that are equal on those ten fields (however differently
 * their other fields differ, and however differently-ordered their object
 * keys are) always produce the byte-identical fingerprint.
 */
export function computeFingerprint(context: ReportContext): string {
  return hashCanonical(toFingerprintInput(context));
}
