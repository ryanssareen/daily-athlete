// Unit tests for the timezone-aware helpers in src/lib/format.ts.

import { describe, expect, it } from "vitest";

import { calendarDayInTimezone } from "@/lib/format";

// ---------------------------------------------------------------------------
// calendarDayInTimezone — which day did the athlete actually train?
// ---------------------------------------------------------------------------

describe("calendarDayInTimezone", () => {
  it("returns the local day, not the UTC day, for an early morning at UTC+5:30", () => {
    // 03:29 IST on the 16th is still 21:59 UTC on the 15th.
    expect(calendarDayInTimezone("2026-05-15T21:59:00Z", "Asia/Calcutta")).toBe("2026-05-16");
  });

  it("returns the local day for a late evening at UTC-4", () => {
    // 20:30 EDT on the 15th is 00:30 UTC on the 16th.
    expect(calendarDayInTimezone("2026-05-16T00:30:00Z", "America/New_York")).toBe("2026-05-15");
  });

  it("agrees with the UTC date for a UTC athlete", () => {
    expect(calendarDayInTimezone("2026-05-15T07:00:00Z", "UTC")).toBe("2026-05-15");
  });

  it("handles a day boundary exactly at local midnight", () => {
    // 00:00 IST on the 16th == 18:30 UTC on the 15th.
    expect(calendarDayInTimezone("2026-05-15T18:30:00Z", "Asia/Calcutta")).toBe("2026-05-16");
    // One minute earlier is still the 15th locally.
    expect(calendarDayInTimezone("2026-05-15T18:29:00Z", "Asia/Calcutta")).toBe("2026-05-15");
  });

  it("respects daylight saving rather than a fixed offset", () => {
    // 2026-01-15 20:30 EST == 2026-01-16 01:30 UTC (UTC-5, winter).
    expect(calendarDayInTimezone("2026-01-16T01:30:00Z", "America/New_York")).toBe("2026-01-15");
    // The same UTC clock time in July is UTC-4, so it is still the 15th.
    expect(calendarDayInTimezone("2026-07-16T01:30:00Z", "America/New_York")).toBe("2026-07-15");
  });

  it("falls back to UTC for a null, empty or bogus timezone instead of throwing", () => {
    for (const tz of [null, undefined, "", "Not/AZone"]) {
      expect(calendarDayInTimezone("2026-05-15T07:00:00Z", tz)).toBe("2026-05-15");
    }
  });

  it("degrades to the leading date rather than throwing on an unparseable instant", () => {
    expect(calendarDayInTimezone("not-a-date", "Asia/Calcutta")).toBe("not-a-date");
  });
});
