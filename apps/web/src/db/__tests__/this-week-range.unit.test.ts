// Unit tests for thisWeekRangeUtc -- the dashboard's "This week" bounds.
// Pure (no DB): asserts the week edges are the athlete's local midnights.

import { describe, expect, it } from "vitest";

import { calendarDayInTimezone } from "@/lib/format";
import { thisWeekRangeUtc } from "@/db/workouts";

describe("thisWeekRangeUtc", () => {
  it("starts the week at local Monday 00:00, not UTC Monday 00:00", () => {
    // Mon Oct 12 2026, 04:00 IST == Sun Oct 11 22:30 UTC.
    const now = new Date("2026-10-11T22:30:00Z");
    const { startUtc, endUtc } = thisWeekRangeUtc("Asia/Calcutta", now);
    // Local Monday 00:00 IST == Sunday 18:30 UTC.
    expect(startUtc.toISOString()).toBe("2026-10-11T18:30:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-10-18T18:30:00.000Z");
  });

  it("keeps a Sunday-evening session west of UTC in the closing week", () => {
    // Sun Oct 18 2026, 20:00 PDT == Mon Oct 19 03:00 UTC (a new UTC week).
    const now = new Date("2026-10-19T03:00:00Z");
    const { startUtc, endUtc } = thisWeekRangeUtc("America/Los_Angeles", now);
    expect(calendarDayInTimezone(startUtc.toISOString(), "America/Los_Angeles")).toBe(
      "2026-10-12",
    );
    expect(now.getTime()).toBeLessThan(endUtc.getTime());
  });

  it("contains `now` for any zone", () => {
    const now = new Date("2026-10-12T03:09:00Z");
    for (const tz of ["UTC", "Asia/Calcutta", "America/New_York", "Pacific/Auckland"]) {
      const { startUtc, endUtc } = thisWeekRangeUtc(tz, now);
      expect(startUtc.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(now.getTime()).toBeLessThan(endUtc.getTime());
    }
  });
});
