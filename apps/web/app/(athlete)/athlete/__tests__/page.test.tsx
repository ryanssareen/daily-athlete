// Unit test for getGreeting (athlete dashboard). Regression coverage for the
// bug where the greeting used new Date().getUTCHours() unconditionally,
// showing every athlete an evening greeting (or any UTC-hour-derived one)
// regardless of their actual local time of day.
//
// The web vitest env is Node-only (no jsdom/testing-library), which is fine
// here -- getGreeting is a pure function of (system time, IANA timezone
// string), so it's directly unit-testable without rendering the page.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGreeting } from "../page";

describe("getGreeting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a different greeting for different timezones at the SAME instant", () => {
    // 2026-01-15T23:30:00Z: 11:30 PM UTC.
    vi.setSystemTime(new Date("2026-01-15T23:30:00Z"));

    // UTC-8 (PST, January): 23:30 - 8h = 15:30 local -> afternoon.
    expect(getGreeting("America/Los_Angeles")).toBe("Good afternoon");
    // UTC+5:30 (IST): 23:30 + 5:30 = 05:00 next day local -> morning.
    expect(getGreeting("Asia/Kolkata")).toBe("Good morning");
    // UTC itself: 23:30 -> evening.
    expect(getGreeting("UTC")).toBe("Good evening");
  });

  it("crosses the morning/afternoon boundary at local noon, not UTC noon", () => {
    // Asia/Kolkata is UTC+5:30, so local noon is 06:30 UTC.
    vi.setSystemTime(new Date("2026-06-01T06:29:00Z")); // 11:59 IST
    expect(getGreeting("Asia/Kolkata")).toBe("Good morning");
    vi.setSystemTime(new Date("2026-06-01T06:30:00Z")); // 12:00 IST
    expect(getGreeting("Asia/Kolkata")).toBe("Good afternoon");
  });

  it("crosses the afternoon/evening boundary at local 17:00, not UTC 17:00", () => {
    vi.setSystemTime(new Date("2026-06-01T11:29:00Z")); // 16:59 IST
    expect(getGreeting("Asia/Kolkata")).toBe("Good afternoon");
    vi.setSystemTime(new Date("2026-06-01T11:30:00Z")); // 17:00 IST
    expect(getGreeting("Asia/Kolkata")).toBe("Good evening");
  });

  it("falls back to the server clock instead of throwing on an invalid stored timezone", () => {
    // A corrupted or pre-migration users.timezone value (or, before this
    // fix, the never-captured 'UTC' default read as if it were real) must
    // not crash the whole dashboard render.
    vi.setSystemTime(new Date("2026-01-15T08:00:00Z")); // 8:00 UTC -> morning
    expect(() => getGreeting("Not/A_Real_Zone")).not.toThrow();
    expect(getGreeting("Not/A_Real_Zone")).toBe("Good morning");
  });
});
