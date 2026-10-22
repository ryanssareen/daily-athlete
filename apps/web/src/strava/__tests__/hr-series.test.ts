import { describe, expect, it } from "vitest";

import { toPerMinute } from "../hr-series";

describe("toPerMinute", () => {
  it("averages samples into whole-minute buckets and tracks the max", () => {
    const time = [0, 30, 59, 60, 90, 120];
    const hr = [100, 110, 120, 130, 150, 140];
    expect(toPerMinute(time, hr)).toEqual([
      { minute: 0, avg: 110, max: 120 },
      { minute: 1, avg: 140, max: 150 },
      { minute: 2, avg: 140, max: 140 },
    ]);
  });

  it("omits minutes with no valid sample instead of zero-filling", () => {
    const out = toPerMinute([0, 10, 180], [120, 124, 150]);
    expect(out.map((p) => p.minute)).toEqual([0, 3]);
  });

  it("ignores sensor dropouts (0 bpm), NaN, and negative time", () => {
    const out = toPerMinute([0, 10, 20, -5, 30], [0, Number.NaN, 140, 150, 160]);
    expect(out).toEqual([{ minute: 0, avg: 150, max: 160 }]);
  });

  it("tolerates mismatched lengths and empty input", () => {
    expect(toPerMinute([0, 60, 120], [100, 110])).toHaveLength(2);
    expect(toPerMinute([], [])).toEqual([]);
  });

  it("drops absurd durations past 24 hours", () => {
    expect(toPerMinute([24 * 3600 + 5], [140])).toEqual([]);
  });
});
