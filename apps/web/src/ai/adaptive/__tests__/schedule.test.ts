import { describe, expect, it } from "vitest";

import {
  isWeeklyReviewDue,
  localPartsInTimezone,
  weeklyReviewWeekKey,
} from "../schedule";

describe("isWeeklyReviewDue", () => {
  it("is due at Sunday 18:00 local in America/New_York", () => {
    // 2026-05-31 is a Sunday. 22:00 UTC = 18:00 EDT (UTC-4).
    const now = new Date("2026-05-31T22:00:00Z");
    expect(isWeeklyReviewDue("America/New_York", now)).toBe(true);
  });

  it("is NOT due at the same instant for a different timezone", () => {
    // 22:00 UTC is 23:00 in London (BST) on Sunday -> not the 18:00 hour.
    const now = new Date("2026-05-31T22:00:00Z");
    expect(isWeeklyReviewDue("Europe/London", now)).toBe(false);
  });

  it("holds across a DST boundary (local 18:00, not fixed UTC)", () => {
    // Before US DST would shift it: pick a winter Sunday. 2026-01-04 Sunday.
    // 23:00 UTC = 18:00 EST (UTC-5).
    const now = new Date("2026-01-04T23:00:00Z");
    expect(isWeeklyReviewDue("America/New_York", now)).toBe(true);
  });

  it("defaults invalid/empty timezone to UTC", () => {
    // 2026-05-31 18:00 UTC, Sunday.
    const now = new Date("2026-05-31T18:00:00Z");
    expect(isWeeklyReviewDue("", now)).toBe(true);
    expect(isWeeklyReviewDue("Not/AZone", now)).toBe(true);
  });

  it("is not due on a non-Sunday", () => {
    const now = new Date("2026-05-30T22:00:00Z"); // Saturday
    expect(isWeeklyReviewDue("America/New_York", now)).toBe(false);
  });
});

describe("localPartsInTimezone", () => {
  it("resolves wall-clock parts in the target timezone", () => {
    const p = localPartsInTimezone("America/New_York", new Date("2026-05-31T22:00:00Z"));
    expect(p.weekday).toBe(0); // Sunday
    expect(p.hour).toBe(18);
    expect(p).toMatchObject({ year: 2026, month: 5, day: 31 });
  });
});

describe("weeklyReviewWeekKey", () => {
  it("produces a stable ISO-week key", () => {
    const key = weeklyReviewWeekKey("America/New_York", new Date("2026-05-31T22:00:00Z"));
    expect(key).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("is identical for two ticks within the same athlete-local week", () => {
    const a = weeklyReviewWeekKey("UTC", new Date("2026-05-31T18:00:00Z")); // Sun
    const b = weeklyReviewWeekKey("UTC", new Date("2026-05-31T19:00:00Z")); // same Sun, later
    expect(a).toBe(b);
  });

  it("rolls over at the ISO week boundary (Sunday -> Monday)", () => {
    const sun = weeklyReviewWeekKey("UTC", new Date("2026-05-31T12:00:00Z")); // Sunday
    const mon = weeklyReviewWeekKey("UTC", new Date("2026-06-01T12:00:00Z")); // Monday (new ISO week)
    expect(sun).not.toBe(mon);
  });
});
