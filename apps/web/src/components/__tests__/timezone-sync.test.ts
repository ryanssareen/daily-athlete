// Unit tests for shouldSyncTimezone, the pure decision behind
// TimezoneSync's self-heal effect. The web vitest env is Node-only (no
// jsdom/testing-library), so the effect itself isn't rendered here --
// this covers the comparison logic that decides whether it fires.

import { describe, expect, it } from "vitest";

import { shouldSyncTimezone } from "../timezone-sync";

describe("shouldSyncTimezone", () => {
  it("returns false when the detected zone matches the stored one", () => {
    expect(shouldSyncTimezone("America/Los_Angeles", "America/Los_Angeles")).toBe(false);
  });

  it("returns true when the detected zone differs from the stored one", () => {
    expect(shouldSyncTimezone("Asia/Kolkata", "UTC")).toBe(true);
  });

  it("returns false when the detected zone is falsy", () => {
    expect(shouldSyncTimezone("", "UTC")).toBe(false);
    expect(shouldSyncTimezone(null, "UTC")).toBe(false);
    expect(shouldSyncTimezone(undefined, "UTC")).toBe(false);
  });
});
