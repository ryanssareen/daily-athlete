// Hand-authored mapping from Strava `sport_type` strings to our canonical
// 6-value Sport enum (swim, bike, run, strength, mobility, other).
//
// Strava emits PascalCase sport_type values; the map keys are exact matches
// (no case folding). Anything not in the map normalises to 'other' -- the
// goal is a tight v1 vocabulary that we can grow as real-world activity
// data surfaces gaps.
//
// Source: docs/plans/2026-05-13-003-feat-strava-integration-plan.md "Sport
// normalization (Phase A v1)".

import type { Sport } from "@da2/shared";

export const STRAVA_SPORT_MAP: Readonly<Record<string, Sport>> = Object.freeze({
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
});

export function normalizeSport(stravaSportType: string): Sport {
  return STRAVA_SPORT_MAP[stravaSportType] ?? "other";
}
