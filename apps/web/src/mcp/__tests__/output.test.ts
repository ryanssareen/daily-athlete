import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_OUTPUT_FIELDS,
  curateSummaryStats,
  projectCompleted,
} from "../output";

// Operationalizes R7 / AE3: prove the projection layer cannot leak a sensitive
// field even when the raw row carries every forbidden one.

function collectKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, acc);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      collectKeys(v, acc);
    }
  }
  return acc;
}

const RAW_COMPLETED = {
  id: "w1",
  athlete_id: "u1",
  source: "strava",
  strava_activity_id: 123456789, // forbidden
  started_at: "2026-06-01T07:00:00+00:00",
  sport: "run",
  distance_m: 10000,
  duration_s: 3000,
  superseded_by_id: "w2", // forbidden
  deleted_at: null, // forbidden
  created_at: "2026-06-01T08:00:00+00:00",
  summary_stats: {
    tss: 80,
    intensity_factor: 0.82,
    average_heartrate: 150,
    ftp_at_workout: 270, // forbidden internal
    hr_max_at_workout: 190, // forbidden internal
    normalized_power_w: 240, // forbidden internal
    weighted_average_watts: 235, // forbidden internal
    device_watts: true, // forbidden internal
    hydrated_at: "2026-06-01T08:05:00Z", // forbidden internal
    polyline: "abc==", // unknown passthrough — must be dropped (allowlist)
  },
};

describe("projectCompleted", () => {
  it("never emits any forbidden field", () => {
    const out = projectCompleted(RAW_COMPLETED);
    const keys = collectKeys(out);
    for (const forbidden of FORBIDDEN_OUTPUT_FIELDS) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("keeps allowed summary stats and drops everything else", () => {
    const out = projectCompleted(RAW_COMPLETED) as { stats: Record<string, number> };
    expect(out.stats.tss).toBe(80);
    expect(out.stats.intensity_factor).toBe(0.82);
    expect(out.stats.average_heartrate).toBe(150);
    expect(out.stats.ftp_at_workout).toBeUndefined();
    expect(out.stats.normalized_power_w).toBeUndefined();
    expect("polyline" in out.stats).toBe(false);
  });
});

describe("curateSummaryStats", () => {
  it("is an allowlist (unknown + forbidden keys never survive)", () => {
    const curated = curateSummaryStats(RAW_COMPLETED.summary_stats);
    const keys = collectKeys(curated);
    for (const forbidden of FORBIDDEN_OUTPUT_FIELDS) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(keys.has("polyline")).toBe(false);
  });

  it("handles null/undefined safely", () => {
    expect(curateSummaryStats(null)).toEqual({});
    expect(curateSummaryStats(undefined)).toEqual({});
  });
});
