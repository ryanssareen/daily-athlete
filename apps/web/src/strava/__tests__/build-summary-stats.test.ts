import { describe, expect, it } from "vitest";

import { buildSummaryStats, mergeEnrichment } from "@/strava/build-summary-stats";
import type { StravaActivity } from "@/strava/schemas";

function activity(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 1,
    name: "",
    sport_type: "Ride",
    start_date: "2026-05-18T12:00:00Z",
    ...overrides,
  };
}

describe("buildSummaryStats", () => {
  it("captures every product-valuable field when present", () => {
    const stats = buildSummaryStats(
      activity({
        name: "Skyline loop",
        description: "felt strong",
        average_heartrate: 152,
        max_heartrate: 178,
        has_heartrate: true,
        average_watts: 215,
        weighted_average_watts: 248,
        max_watts: 612,
        kilojoules: 1318,
        device_watts: true,
        average_cadence: 86,
        total_elevation_gain: 540,
        elev_high: 524,
        elev_low: 142,
        average_temp: 17,
        calories: 950,
        suffer_score: 87,
        trainer: false,
        commute: false,
        manual: false,
        pr_count: 0,
        achievement_count: 4,
        map: { summary_polyline: "abc123" },
      })
    );

    expect(stats).toMatchObject({
      name: "Skyline loop",
      description: "felt strong",
      average_heartrate: 152,
      weighted_average_watts: 248,
      kilojoules: 1318,
      device_watts: true,
      calories: 950,
      polyline: "abc123",
    });
  });

  it("omits keys for absent fields (no nulls, no undefineds)", () => {
    const stats = buildSummaryStats(activity());
    expect(stats).toEqual({});
  });

  it("preserves explicit device_watts === false (estimated power)", () => {
    const stats = buildSummaryStats(activity({ device_watts: false }));
    expect(stats.device_watts).toBe(false);
  });

  it("does not store an empty polyline", () => {
    const stats = buildSummaryStats(activity({ map: { summary_polyline: "" } }));
    expect(stats.polyline).toBeUndefined();
  });

  it("does not store the name key when it's the schema default empty string", () => {
    // The schema defaults `name` to "" — we should treat that as absent.
    const stats = buildSummaryStats(activity({ name: "" }));
    expect(stats.name).toBeUndefined();
  });
});

describe("mergeEnrichment", () => {
  it("attaches laps + zones + hydrated_at", () => {
    const merged = mergeEnrichment(
      { name: "x" },
      [
        {
          lap_index: 1,
          elapsed_time: 100,
          moving_time: 95,
          distance: 1000,
        },
      ],
      [
        {
          type: "power",
          distribution_buckets: [{ min: 0, max: 100, time: 60 }],
        },
      ]
    );
    expect(merged.name).toBe("x");
    expect(Array.isArray(merged.laps)).toBe(true);
    expect(Array.isArray(merged.zones)).toBe(true);
    expect(typeof merged.hydrated_at).toBe("string");
  });

  it("omits laps key when laps is null", () => {
    const merged = mergeEnrichment({}, null, []);
    expect(merged.laps).toBeUndefined();
    expect(merged.zones).toEqual([]);
  });

  it("does not mutate the input base object", () => {
    const base = { name: "x" };
    mergeEnrichment(base, null, null);
    expect(base).toEqual({ name: "x" });
  });

  // #103: `hydrated_at` is the "never hydrate this row again" marker, so
  // stamping it after a failed enrichment froze rows with no laps/zones and
  // no retry path.
  it("withholds hydrated_at when an enrichment endpoint threw", () => {
    const merged = mergeEnrichment({ name: "x" }, null, null, true);
    expect(merged.hydrated_at).toBeUndefined();
    expect(merged.name).toBe("x");
  });

  it("still stamps hydrated_at when endpoints answered with no data", () => {
    // 404 -> null and [] are both definitive answers, not failures; retrying
    // them on every render would hammer Strava for activities that will
    // never have zones.
    const merged = mergeEnrichment({}, null, [], false);
    expect(typeof merged.hydrated_at).toBe("string");
  });

  it("defaults to stamping hydrated_at when the flag is omitted", () => {
    expect(typeof mergeEnrichment({}, null, null).hydrated_at).toBe("string");
  });
});
