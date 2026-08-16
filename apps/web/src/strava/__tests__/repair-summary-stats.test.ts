import { describe, expect, it } from "vitest";

import { fillMissingSummaryStats } from "@/strava/repair-summary-stats";
import type { StravaActivity } from "@/strava/schemas";

function activity(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 1,
    name: "",
    sport_type: "Run",
    start_date: "2026-05-17T06:00:00Z",
    ...overrides,
  };
}

describe("fillMissingSummaryStats", () => {
  it("adds cadence and has_heartrate to a pre-2026-05-18 vintage row", () => {
    // Exactly what the 2026-05-17 backfill wrote: HR value present, but the
    // projection of that vintage had no `average_cadence` / `has_heartrate`.
    const legacy = {
      name: "Morning Run",
      average_heartrate: 148,
      max_heartrate: 171,
      average_speed: 3.1,
    };

    const result = fillMissingSummaryStats(
      legacy,
      activity({
        name: "Morning Run",
        average_heartrate: 148,
        max_heartrate: 171,
        average_speed: 3.1,
        average_cadence: 84,
        has_heartrate: true,
      })
    );

    expect(result).not.toBeNull();
    expect(result!.added.sort()).toEqual(["average_cadence", "has_heartrate"]);
    expect(result!.stats.average_cadence).toBe(84);
    expect(result!.stats.has_heartrate).toBe(true);
    // Untouched keys survive verbatim.
    expect(result!.stats.average_heartrate).toBe(148);
    expect(result!.stats.name).toBe("Morning Run");
  });

  it("preserves enrichment the summary endpoint cannot reproduce", () => {
    const hydrated = {
      average_heartrate: 148,
      calories: 620,
      weighted_average_watts: 240,
      tss: 71,
      intensity_factor: 0.84,
      laps: [{ lap_index: 0 }],
      zones: [],
      hydrated_at: "2026-06-01T00:00:00.000Z",
    };

    const result = fillMissingSummaryStats(
      hydrated,
      activity({ average_heartrate: 148, average_cadence: 84 })
    );

    expect(result!.added).toEqual(["average_cadence"]);
    expect(result!.stats.tss).toBe(71);
    expect(result!.stats.intensity_factor).toBe(0.84);
    expect(result!.stats.calories).toBe(620);
    expect(result!.stats.weighted_average_watts).toBe(240);
    expect(result!.stats.laps).toEqual([{ lap_index: 0 }]);
    expect(result!.stats.zones).toEqual([]);
    expect(result!.stats.hydrated_at).toBe("2026-06-01T00:00:00.000Z");
  });

  it("never overwrites a value already stored", () => {
    // A later hydration recorded max_heartrate from the detail endpoint;
    // a stale summary value must not win.
    const existing = { average_heartrate: 150, max_heartrate: 180 };

    const result = fillMissingSummaryStats(
      existing,
      activity({ average_heartrate: 999, max_heartrate: 999, average_cadence: 84 })
    );

    expect(result!.stats.average_heartrate).toBe(150);
    expect(result!.stats.max_heartrate).toBe(180);
    expect(result!.added).toEqual(["average_cadence"]);
  });

  it("treats a stored falsy value as present, not as missing", () => {
    // `has_heartrate: false` and `total_elevation_gain: 0` are meaningful.
    // A `!existing[key]` check would wrongly refill them.
    const existing = { has_heartrate: false, total_elevation_gain: 0, trainer: false };

    const result = fillMissingSummaryStats(
      existing,
      activity({ has_heartrate: true, total_elevation_gain: 540, trainer: true })
    );

    expect(result).toBeNull();
  });

  it("returns null when nothing is missing, so callers can skip the write", () => {
    const act = activity({ average_heartrate: 148, average_cadence: 84, has_heartrate: true });
    const full = fillMissingSummaryStats({}, act)!.stats;

    expect(fillMissingSummaryStats(full, act)).toBeNull();
  });

  it("is idempotent — a second pass adds nothing", () => {
    const act = activity({ average_cadence: 84, has_heartrate: true });
    const first = fillMissingSummaryStats({ average_heartrate: 148 }, act)!;

    expect(fillMissingSummaryStats(first.stats, act)).toBeNull();
  });

  it("handles a row whose summary_stats is empty or null", () => {
    const act = activity({ average_cadence: 84 });

    expect(fillMissingSummaryStats(null, act)!.stats.average_cadence).toBe(84);
    expect(fillMissingSummaryStats(undefined, act)!.stats.average_cadence).toBe(84);
    expect(fillMissingSummaryStats({}, act)!.stats.average_cadence).toBe(84);
  });
});
