// Hand-authored mapping from Strava `sport_type` strings to our canonical
// 6-value Sport enum (swim, bike, run, strength, mobility, other).
//
// Strava emits PascalCase sport_type values; the map keys are exact matches
// (no case folding). Anything not in the map normalises to 'other' -- the
// goal is a tight v1 vocabulary that we can grow as real-world activity
// data surfaces gaps.
//
// The map uses Object.create(null) so prototype-chain keys ('__proto__',
// 'constructor', 'toString', etc.) cannot leak through bracket-notation
// lookup. The type is `Record<string, Sport | undefined>` so callers must
// account for the unmapped case (the `?? 'other'` fallback below).
//
// Source: docs/plans/2026-05-13-003-feat-strava-integration-plan.md "Sport
// normalization (Phase A v1)".

import type { Sport } from "@da2/shared";

const RAW_MAP: Record<string, Sport> = {
  Run: "run",
  TrailRun: "run",
  Ride: "bike",
  MountainBikeRide: "bike",
  GravelRide: "bike",
  EBikeRide: "bike",
  VirtualRide: "bike",
  EMountainBikeRide: "bike",
  Swim: "swim",
  WeightTraining: "strength",
  Workout: "strength",
  Crossfit: "strength",
  Yoga: "mobility",
  Stretching: "mobility",
  Pilates: "mobility",
};

// Build a null-prototype map so STRAVA_SPORT_MAP['__proto__'] cannot return
// Object.prototype (which would bypass `?? 'other'` because it's truthy).
function buildSportMap(): Readonly<Record<string, Sport | undefined>> {
  const m = Object.create(null) as Record<string, Sport | undefined>;
  for (const [k, v] of Object.entries(RAW_MAP)) m[k] = v;
  return Object.freeze(m);
}

export const STRAVA_SPORT_MAP: Readonly<Record<string, Sport | undefined>> =
  buildSportMap();

export function normalizeSport(stravaSportType: string): Sport {
  return STRAVA_SPORT_MAP[stravaSportType] ?? "other";
}
