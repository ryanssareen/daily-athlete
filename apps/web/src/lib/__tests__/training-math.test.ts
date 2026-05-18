import { describe, expect, it } from "vitest";

import { computeIF, computeTSS } from "@/lib/training-math";

describe("computeIF", () => {
  it("returns 1.0 when NP equals FTP", () => {
    expect(computeIF(265, 265)).toBeCloseTo(1.0, 4);
  });

  it("returns ~1.13 when NP exceeds FTP by ~13%", () => {
    expect(computeIF(300, 265)).toBeCloseTo(300 / 265, 4);
  });

  it("returns null for non-positive NP", () => {
    expect(computeIF(0, 265)).toBeNull();
    expect(computeIF(-50, 265)).toBeNull();
  });

  it("returns null for non-positive FTP (avoid divide-by-zero)", () => {
    expect(computeIF(265, 0)).toBeNull();
    expect(computeIF(265, -10)).toBeNull();
  });

  it("returns null for NaN inputs", () => {
    expect(computeIF(Number.NaN, 265)).toBeNull();
    expect(computeIF(265, Number.NaN)).toBeNull();
  });
});

describe("computeTSS", () => {
  it("canonical 1-hour FTP test: TSS = 100", () => {
    // 3600s at NP=FTP=265 → TSS = (3600 × 265 × 1.0) / (265 × 3600) × 100 = 100
    expect(computeTSS(3600, 265, 265)).toBeCloseTo(100, 4);
  });

  it("2-hour endurance at IF 0.7 ≈ 98 TSS", () => {
    // 2h at 0.7 × FTP: TSS = 7200 × 185.5 × 0.7 / (265 × 3600) × 100 ≈ 98
    const np = 0.7 * 265;
    const tss = computeTSS(7200, np, 265);
    expect(tss).not.toBeNull();
    expect(tss!).toBeGreaterThan(95);
    expect(tss!).toBeLessThan(101);
  });

  it("scales linearly with duration", () => {
    const a = computeTSS(1800, 265, 265);
    const b = computeTSS(3600, 265, 265);
    expect(a).toBeCloseTo(50, 4);
    expect(b).toBeCloseTo(100, 4);
  });

  it("returns null for zero / negative duration", () => {
    expect(computeTSS(0, 265, 265)).toBeNull();
    expect(computeTSS(-1, 265, 265)).toBeNull();
  });

  it("returns null when IF is undefined (zero FTP)", () => {
    expect(computeTSS(3600, 265, 0)).toBeNull();
  });
});
