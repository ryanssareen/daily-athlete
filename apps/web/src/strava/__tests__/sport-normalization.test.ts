// Tests for the Strava sport_type -> canonical Sport mapping.
// Pure data; no env, no I/O. The map is the contract.

import { describe, expect, it } from "vitest";

import {
  STRAVA_SPORT_MAP,
  normalizeSport,
} from "../sport-normalization";

describe("normalizeSport -- documented mappings", () => {
  it.each([
    ["Run", "run"],
    ["TrailRun", "run"],
    ["Ride", "bike"],
    ["MountainBikeRide", "bike"],
    ["GravelRide", "bike"],
    ["EBikeRide", "bike"],
    ["VirtualRide", "bike"],
    ["EMountainBikeRide", "bike"],
    ["Swim", "swim"],
    ["WeightTraining", "strength"],
    ["Workout", "strength"],
    ["Crossfit", "strength"],
    ["Yoga", "mobility"],
    ["Stretching", "mobility"],
    ["Pilates", "mobility"],
  ] as const)("maps %s -> %s", (input, expected) => {
    expect(normalizeSport(input)).toBe(expected);
  });
});

describe("normalizeSport -- fallback behaviour", () => {
  it("returns 'other' for unknown Strava sport_type values", () => {
    expect(normalizeSport("Snowboard")).toBe("other");
    expect(normalizeSport("AlpineSki")).toBe("other");
    expect(normalizeSport("Hike")).toBe("other");
  });

  it("returns 'other' for empty string", () => {
    expect(normalizeSport("")).toBe("other");
  });

  it("is case-sensitive: 'run' (lowercase) does NOT match 'Run'", () => {
    // Strava emits PascalCase; we don't case-fold so we surface real-world
    // vocabulary drift rather than silently bucket it as 'run'.
    expect(normalizeSport("run")).toBe("other");
    expect(normalizeSport("RUN")).toBe("other");
  });

  it("returns 'other' for inherited Object.prototype keys", () => {
    // A plain object map would return Object.prototype / Function / etc. for
    // these inputs via prototype-chain bracket lookup, and those values are
    // truthy so `?? 'other'` would not fire. The null-prototype map blocks
    // the lookup at its source.
    expect(normalizeSport("__proto__")).toBe("other");
    expect(normalizeSport("constructor")).toBe("other");
    expect(normalizeSport("toString")).toBe("other");
    expect(normalizeSport("valueOf")).toBe("other");
    expect(normalizeSport("hasOwnProperty")).toBe("other");
  });
});

describe("STRAVA_SPORT_MAP -- frozen contract", () => {
  it("is a frozen object so callers can't mutate it at runtime", () => {
    expect(Object.isFrozen(STRAVA_SPORT_MAP)).toBe(true);
  });

  it("contains exactly the documented v1 vocabulary", () => {
    // Pin the keyset so any change is forced through a deliberate code edit
    // (and a Phase D conversation about retroactive matcher impact).
    expect(Object.keys(STRAVA_SPORT_MAP).sort()).toEqual(
      [
        "Crossfit",
        "EBikeRide",
        "EMountainBikeRide",
        "GravelRide",
        "MountainBikeRide",
        "Pilates",
        "Ride",
        "Run",
        "Stretching",
        "Swim",
        "TrailRun",
        "VirtualRide",
        "WeightTraining",
        "Workout",
        "Yoga",
      ].sort()
    );
  });
});
