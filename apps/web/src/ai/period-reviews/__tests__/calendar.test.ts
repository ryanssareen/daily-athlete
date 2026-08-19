// Tests for the period calendar (U3).
//
// This is the highest-risk arithmetic in the whole feature. Period boundaries
// AND delivery timing both depend on it, and
// docs/solutions/athlete-timezone-capture.md records that this class of bug has
// already bitten this repo once. Everything here is a real timezone with a real
// DST rule, not a synthetic offset.

import { describe, expect, it } from "vitest";

import {
  enumerateRecentPeriods,
  periodBounds,
  periodKeyForInstant,
  periodRangeUtc,
  previousPeriodKey,
} from "../calendar";

const LONDON = "Europe/London";
const LA = "America/Los_Angeles";
const SYDNEY = "Australia/Sydney";
const KATHMANDU = "Asia/Kathmandu"; // UTC+05:45 — a non-hour offset

describe("periodKeyForInstant — weekly", () => {
  it("resolves an ordinary mid-week instant to its ISO week", () => {
    // Wed 2026-08-12 12:00 London
    expect(periodKeyForInstant("weekly", LONDON, new Date("2026-08-12T11:00:00Z"))).toBe(
      "2026-W33",
    );
  });

  // The boundary case that separates a timezone-correct implementation from a
  // UTC one: 23:50 local Sunday is still the closing week, and 00:10 local
  // Monday is already the next one — even though both are the same UTC day.
  it("puts 23:50 local on the period's last day INSIDE the period", () => {
    // Sun 2026-08-16 23:50 London (BST, UTC+1) = 22:50Z
    expect(periodKeyForInstant("weekly", LONDON, new Date("2026-08-16T22:50:00Z"))).toBe(
      "2026-W33",
    );
  });

  it("puts 00:10 local on the next day OUTSIDE the period", () => {
    // Mon 2026-08-17 00:10 London = 23:10Z on the 16th
    expect(periodKeyForInstant("weekly", LONDON, new Date("2026-08-16T23:10:00Z"))).toBe(
      "2026-W34",
    );
  });

  // Same UTC instant, three timezones, three different answers — which is the
  // entire point of resolving in the athlete's zone.
  it("resolves the same instant to different weeks in different zones", () => {
    // 2026-08-16T14:00Z is Sunday afternoon in LA and London, but already
    // Monday in Sydney (UTC+10).
    const instant = new Date("2026-08-16T14:00:00Z");
    expect(periodKeyForInstant("weekly", LA, instant)).toBe("2026-W33");
    expect(periodKeyForInstant("weekly", LONDON, instant)).toBe("2026-W33");
    expect(periodKeyForInstant("weekly", SYDNEY, instant)).toBe("2026-W34");
  });

  it("handles a non-hour UTC offset", () => {
    // 2026-08-16T18:20Z = Mon 2026-08-17 00:05 in Kathmandu (+05:45)
    expect(periodKeyForInstant("weekly", KATHMANDU, new Date("2026-08-16T18:20:00Z"))).toBe(
      "2026-W34",
    );
  });

  // ISO weeks belong to an ISO YEAR, which is not the calendar year at the
  // boundary. 2026-01-01 is a Thursday, so it falls in ISO week 1 of 2026;
  // 2025-12-29 (Monday) is ALSO in 2026-W01.
  it("assigns a late-December date to the following ISO year's week 1", () => {
    expect(periodKeyForInstant("weekly", LONDON, new Date("2025-12-29T12:00:00Z"))).toBe(
      "2026-W01",
    );
  });

  it("assigns an early-January date to the previous ISO year's last week", () => {
    // 2027-01-01 is a Friday, in ISO week 53 of 2026.
    expect(periodKeyForInstant("weekly", LONDON, new Date("2027-01-01T12:00:00Z"))).toBe(
      "2026-W53",
    );
  });
});

describe("periodKeyForInstant — monthly", () => {
  it("resolves an ordinary instant to its calendar month", () => {
    expect(periodKeyForInstant("monthly", LONDON, new Date("2026-08-12T11:00:00Z"))).toBe(
      "2026-08",
    );
  });

  it("respects the local month boundary, not the UTC one", () => {
    // 2026-08-31T23:30Z is still August in London (00:30 on Sep 1 BST → wait:
    // London is UTC+1, so 23:30Z = 00:30 Sep 1 local) — September.
    expect(periodKeyForInstant("monthly", LONDON, new Date("2026-08-31T23:30:00Z"))).toBe(
      "2026-09",
    );
    // ...while in LA (UTC-7) the same instant is 16:30 on Aug 31 — August.
    expect(periodKeyForInstant("monthly", LA, new Date("2026-08-31T23:30:00Z"))).toBe("2026-08");
  });
});

describe("periodBounds", () => {
  it("returns Monday..Sunday for an ISO week", () => {
    expect(periodBounds("weekly", "2026-W33")).toEqual({
      start: "2026-08-10",
      end: "2026-08-16",
    });
  });

  it("returns the first..last day for a 31-day month", () => {
    expect(periodBounds("monthly", "2026-08")).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
    });
  });

  it("returns the first..last day for a 30-day month", () => {
    expect(periodBounds("monthly", "2026-09")).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
  });

  it("returns 28 days for a common-year February", () => {
    expect(periodBounds("monthly", "2026-02")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });

  it("returns 29 days for a leap-year February", () => {
    expect(periodBounds("monthly", "2028-02")).toEqual({
      start: "2028-02-01",
      end: "2028-02-29",
    });
  });

  it("spans the year boundary for a week that does", () => {
    // 2026-W01 runs Mon 2025-12-29 .. Sun 2026-01-04.
    expect(periodBounds("weekly", "2026-W01")).toEqual({
      start: "2025-12-29",
      end: "2026-01-04",
    });
  });

  it("resolves week 53 in a long ISO year", () => {
    const bounds = periodBounds("weekly", "2026-W53");
    expect(bounds.start).toBe("2026-12-28");
    expect(bounds.end).toBe("2027-01-03");
  });

  it("throws on a key that does not match its kind", () => {
    expect(() => periodBounds("weekly", "2026-08")).toThrow();
    expect(() => periodBounds("monthly", "2026-W33")).toThrow();
  });

  it("throws on a malformed key rather than guessing", () => {
    expect(() => periodBounds("weekly", "last-week")).toThrow();
  });
});

describe("periodRangeUtc", () => {
  it("returns a half-open range anchored on local midnight", () => {
    const { startUtc, endUtc } = periodRangeUtc("weekly", "2026-W33", LONDON);
    // London is BST (UTC+1) in August: local Mon 00:00 = Sun 23:00Z.
    expect(startUtc.toISOString()).toBe("2026-08-09T23:00:00.000Z");
    // Half-open: the instant local Monday-after starts.
    expect(endUtc.toISOString()).toBe("2026-08-16T23:00:00.000Z");
  });

  it("anchors on the athlete's local midnight, not UTC midnight", () => {
    const { startUtc } = periodRangeUtc("weekly", "2026-W33", LA);
    // LA is PDT (UTC-7) in August: local Mon 00:00 = 07:00Z.
    expect(startUtc.toISOString()).toBe("2026-08-10T07:00:00.000Z");
  });

  // A DST-transition week is not 168 hours long. If the range were computed as
  // start + 7*24h, it would be off by an hour and silently drop or double-count
  // a workout at the edge.
  it("produces a 167-hour week across the spring-forward transition", () => {
    // UK clocks go forward on Sunday 2026-03-29. That Sunday is in 2026-W13
    // (Mon 2026-03-23 .. Sun 2026-03-29).
    const { startUtc, endUtc } = periodRangeUtc("weekly", "2026-W13", LONDON);
    const hours = (endUtc.getTime() - startUtc.getTime()) / 3_600_000;
    expect(hours).toBe(167);
  });

  it("produces a 169-hour week across the autumn fall-back transition", () => {
    // UK clocks go back on Sunday 2026-10-25, in 2026-W43.
    const { startUtc, endUtc } = periodRangeUtc("weekly", "2026-W43", LONDON);
    const hours = (endUtc.getTime() - startUtc.getTime()) / 3_600_000;
    expect(hours).toBe(169);
  });

  it("handles a southern-hemisphere DST month", () => {
    // Sydney clocks go forward on Sunday 2026-10-04.
    const { startUtc, endUtc } = periodRangeUtc("monthly", "2026-10", SYDNEY);
    const hours = (endUtc.getTime() - startUtc.getTime()) / 3_600_000;
    expect(hours).toBe(31 * 24 - 1);
  });

  // The read boundary that matters: an instant inside the range must be
  // exactly the set of instants that resolve to this period key.
  it("agrees with periodKeyForInstant at both edges", () => {
    const key = "2026-W33";
    const { startUtc, endUtc } = periodRangeUtc("weekly", key, LONDON);
    expect(periodKeyForInstant("weekly", LONDON, startUtc)).toBe(key);
    expect(periodKeyForInstant("weekly", LONDON, new Date(endUtc.getTime() - 1))).toBe(key);
    // endUtc itself is EXCLUDED — half-open.
    expect(periodKeyForInstant("weekly", LONDON, endUtc)).not.toBe(key);
  });
});

describe("previousPeriodKey", () => {
  it("steps back one ISO week", () => {
    expect(previousPeriodKey("weekly", "2026-W33")).toBe("2026-W32");
  });

  it("steps back across the ISO year boundary into week 53", () => {
    expect(previousPeriodKey("weekly", "2027-W01")).toBe("2026-W53");
  });

  it("steps back across a short ISO year boundary into week 52", () => {
    // 2026-W01's predecessor is the last week of ISO year 2025, which is W52.
    expect(previousPeriodKey("weekly", "2026-W01")).toBe("2025-W52");
  });

  it("steps back one calendar month", () => {
    expect(previousPeriodKey("monthly", "2026-08")).toBe("2026-07");
  });

  it("steps back across the calendar year boundary", () => {
    expect(previousPeriodKey("monthly", "2026-01")).toBe("2025-12");
  });
});

describe("enumerateRecentPeriods", () => {
  it("lists completed periods newest-first, excluding the in-flight one", () => {
    // Wed 2026-08-12 local — 2026-W33 is still running, so the newest
    // COMPLETED week is W32.
    const keys = enumerateRecentPeriods("weekly", LONDON, new Date("2026-08-12T11:00:00Z"), 3);
    expect(keys).toEqual(["2026-W32", "2026-W31", "2026-W30"]);
  });

  it("lists completed months newest-first", () => {
    const keys = enumerateRecentPeriods("monthly", LONDON, new Date("2026-08-12T11:00:00Z"), 3);
    expect(keys).toEqual(["2026-07", "2026-06", "2026-05"]);
  });

  it("returns an empty list when asked for zero periods", () => {
    expect(enumerateRecentPeriods("weekly", LONDON, new Date("2026-08-12T11:00:00Z"), 0)).toEqual(
      [],
    );
  });

  it("never returns the in-flight period even at the instant one closes", () => {
    // Mon 2026-08-17 00:00:01 London — W34 just began and must not be listed.
    const keys = enumerateRecentPeriods("weekly", LONDON, new Date("2026-08-16T23:00:01Z"), 2);
    expect(keys).toEqual(["2026-W33", "2026-W32"]);
  });
});

describe("invalid timezone handling", () => {
  // users.timezone defaults to 'UTC' and is athlete-supplied via the sync
  // route; a garbage value must degrade, not throw, or one bad row takes down
  // the whole scheduler sweep.
  it("falls back to UTC without throwing", () => {
    expect(() =>
      periodKeyForInstant("weekly", "Not/AZone", new Date("2026-08-12T11:00:00Z")),
    ).not.toThrow();
    expect(periodKeyForInstant("weekly", "Not/AZone", new Date("2026-08-12T11:00:00Z"))).toBe(
      periodKeyForInstant("weekly", "UTC", new Date("2026-08-12T11:00:00Z")),
    );
  });

  it("falls back to UTC for range computation too", () => {
    const { startUtc } = periodRangeUtc("weekly", "2026-W33", "Not/AZone");
    expect(startUtc.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });
});
