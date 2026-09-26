// Unit tests for the shared IANA timezone validator, extracted from
// PATCH /api/profile/timezone's route.ts so the MCP profile_update tool
// can reuse identical validation.

import { describe, expect, it } from "vitest";

import { isValidIanaTimezone } from "../timezone";

describe("isValidIanaTimezone", () => {
  it("accepts canonical IANA zones and UTC", () => {
    expect(isValidIanaTimezone("America/Los_Angeles")).toBe(true);
    expect(isValidIanaTimezone("UTC")).toBe(true);
  });

  it("accepts legacy aliases that resolve to a canonical zone", () => {
    // Asia/Kolkata is an alias; Intl canonicalizes it to Asia/Calcutta.
    expect(isValidIanaTimezone("Asia/Kolkata")).toBe(true);
  });

  it("rejects a syntactically invalid identifier", () => {
    expect(isValidIanaTimezone("Not/A_Real_Zone")).toBe(false);
  });

  it("rejects raw UTC-offset strings even though Intl.DateTimeFormat accepts them", () => {
    expect(isValidIanaTimezone("+05:30")).toBe(false);
    expect(isValidIanaTimezone("-08:00")).toBe(false);
  });

  it("rejects sign-inverted Etc/GMT zones", () => {
    // Etc/GMT+12 is actually UTC-12 (POSIX sign convention is inverted).
    expect(isValidIanaTimezone("Etc/GMT+12")).toBe(false);
  });
});
