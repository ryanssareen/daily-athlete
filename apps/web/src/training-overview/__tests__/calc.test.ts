import { describe, expect, it } from "vitest";

import { bySport, daysUntil, formVerdict, last28, mondayOf, weeklyBuckets } from "../calc";

const today = "2026-10-09";
const w = (day: string, sport: string, durationS: number) => ({ day, sport, durationS });

describe("training overview calc", () => {
  it("finds the Monday of a week", () => {
    expect(mondayOf("2026-10-09")).toBe("2026-10-05");
    expect(mondayOf("2026-10-11")).toBe("2026-10-05");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
  });

  it("buckets weekly hours by sport, merges ride into bike, drops stubs", () => {
    const buckets = weeklyBuckets(
      [w("2026-10-06", "run", 3600), w("2026-10-07", "ride", 7200), w("2026-10-08", "swim", 30)],
      today,
      3,
    );
    expect(buckets).toHaveLength(3);
    const last = buckets[2];
    expect(last.weekStart).toBe("2026-10-05");
    expect(last.bySport).toEqual({ run: 1, bike: 2 });
    expect(last.totalH).toBe(3);
  });

  it("compares the last 28 days to the prior 28", () => {
    const r = last28([w("2026-10-08", "run", 7200), w("2026-09-01", "run", 3600)], today);
    expect(r.hours).toBe(2);
    expect(r.prevHours).toBe(1);
    expect(r.deltaPct).toBe(1);
    expect(last28([], today).deltaPct).toBeNull();
  });

  it("summarises by sport, longest-hours first", () => {
    const rows = bySport([w("2026-10-08", "run", 3600), w("2026-06-01", "bike", 7200)], today);
    expect(rows.map((r) => r.sport)).toEqual(["bike", "run"]);
    expect(rows[0].sessions28).toBe(0);
    expect(rows[1].hours28).toBe(1);
  });

  it("describes form and race countdown", () => {
    expect(formVerdict(10)).toBe("fresh");
    expect(formVerdict(-40)).toBe("very fatigued");
    expect(daysUntil("2026-10-19", today)).toBe(10);
    expect(daysUntil("2026-10-01", today)).toBeNull();
  });
});
