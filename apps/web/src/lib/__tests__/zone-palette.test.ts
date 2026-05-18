import { describe, expect, it } from "vitest";

import { HR_ZONES, POWER_ZONES, paletteFor } from "@/lib/zone-palette";

describe("zone palette", () => {
  it("POWER_ZONES has exactly 6 entries with valid hex colors", () => {
    expect(POWER_ZONES).toHaveLength(6);
    for (const zone of POWER_ZONES) {
      expect(zone.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(zone.name).toMatch(/^Z\d$/);
      expect(zone.label.length).toBeGreaterThan(0);
    }
  });

  it("HR_ZONES has exactly 5 entries with valid hex colors", () => {
    expect(HR_ZONES).toHaveLength(5);
    for (const zone of HR_ZONES) {
      expect(zone.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("paletteFor power returns the first N entries", () => {
    expect(paletteFor("power", 3)).toEqual(POWER_ZONES.slice(0, 3));
    expect(paletteFor("power", 6)).toEqual(POWER_ZONES);
  });

  it("paletteFor heartrate returns the first N entries", () => {
    expect(paletteFor("heartrate", 5)).toEqual(HR_ZONES);
  });

  it("truncates to palette size when count exceeds entries", () => {
    // Renderer handles out-of-range via palette[i] ?? tail fallback;
    // paletteFor itself just returns the base palette capped at its length.
    const result = paletteFor("heartrate", 7);
    expect(result).toEqual(HR_ZONES);
    expect(result).toHaveLength(5);
  });
});
