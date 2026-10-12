// Unit tests for the timezone-aware helpers in src/lib/format.ts.

import { afterEach, describe, expect, it } from "vitest";

import { calendarDayInTimezone, localDay, manualStartedAt } from "@/lib/format";

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

// ---------------------------------------------------------------------------
// manualStartedAt — date-only manual log → started_at instant
// ---------------------------------------------------------------------------

describe("manualStartedAt", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    // Assigning undefined would set the literal string "undefined".
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  // Node re-reads TZ on assignment, so local-time Date methods follow it.
  for (const tz of ["America/Los_Angeles", "America/New_York", "UTC", "Asia/Calcutta", "Pacific/Auckland"]) {
    it(`keeps a past day on that day for an athlete in ${tz}`, () => {
      process.env.TZ = tz;
      const now = new Date("2026-10-12T09:00:00Z");
      const startedAt = manualStartedAt("2026-10-05", now);
      expect(calendarDayInTimezone(startedAt, tz)).toBe("2026-10-05");
    });
  }

  it("uses local noon for a day other than today, not UTC midnight", () => {
    process.env.TZ = "America/New_York";
    // 12:00 EDT on Oct 5 == 16:00 UTC.
    expect(manualStartedAt("2026-10-05", new Date("2026-10-12T15:00:00Z"))).toBe(
      "2026-10-05T16:00:00.000Z",
    );
  });

  it("uses the current instant when the picked day is today locally", () => {
    process.env.TZ = "Asia/Calcutta";
    // 08:39 IST on Oct 12 — still Oct 11 in UTC, but today for the athlete.
    const now = new Date("2026-10-12T03:09:00Z");
    expect(manualStartedAt("2026-10-12", now)).toBe(now.toISOString());
  });

  it("treats a west-of-UTC evening as today, not tomorrow (paired with localDay)", () => {
    process.env.TZ = "America/Los_Angeles";
    // 20:00 PDT on Oct 12 is already Oct 13 in UTC.
    const now = new Date("2026-10-13T03:00:00Z");
    expect(localDay(now)).toBe("2026-10-12");
    expect(manualStartedAt(localDay(now), now)).toBe(now.toISOString());
  });

  it("stays within ±12h of the picked day's noon when browser and profile timezones differ", () => {
    // Browser in London, profile still on Calcutta (travelling): the session
    // must not drift onto a neighbouring day in the profile timezone.
    process.env.TZ = "Europe/London";
    const startedAt = manualStartedAt("2026-10-05", new Date("2026-10-12T09:00:00Z"));
    expect(calendarDayInTimezone(startedAt, "Asia/Calcutta")).toBe("2026-10-05");
  });
});
