import { describe, expect, it } from "vitest";

import { sportColor } from "../sport-colors";

describe("sportColor", () => {
  it("returns the canonical hex for each sport", () => {
    expect(sportColor("run")).toBe("#c45a30");
    expect(sportColor("bike")).toBe("#2d6b44");
    expect(sportColor("swim")).toBe("#1a6891");
    expect(sportColor("strength")).toBe("#4a3a80");
    expect(sportColor("mobility")).toBe("#6b4c22");
  });

  it("maps provider-style names onto the canonical sports", () => {
    expect(sportColor("Ride")).toBe(sportColor("bike"));
    expect(sportColor("TrailRun")).toBe(sportColor("run"));
  });

  it("falls back to the neutral color for unknown sports", () => {
    expect(sportColor("yoga")).toBe("#8a8478");
    expect(sportColor("other")).toBe("#8a8478");
  });
});
