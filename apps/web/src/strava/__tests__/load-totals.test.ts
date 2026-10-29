import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { toSportTotals } from "@/strava/load-totals";

const t = (count: number) => ({ count, distance: count * 1000, moving_time: count * 300, elevation_gain: count });

describe("toSportTotals", () => {
  it("keeps sports with any activity and drops empty ones", () => {
    const out = toSportTotals({
      recent_run_totals: t(2),
      ytd_run_totals: t(10),
      all_run_totals: t(50),
      all_ride_totals: t(0),
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sport: "run", all: { count: 50 } });
  });

  it("fills missing periods with zeros", () => {
    const out = toSportTotals({ all_swim_totals: t(3) });
    expect(out[0]!.recent.count).toBe(0);
    expect(out[0]!.ytd.distance).toBe(0);
  });

  it("returns [] when Strava reports nothing", () => {
    expect(toSportTotals({})).toEqual([]);
  });
});
