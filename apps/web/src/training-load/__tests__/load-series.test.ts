import { describe, expect, it } from "vitest";

import {
  addDays,
  buildLoadSeries,
  computeWorkoutTss,
  dayDiff,
  durationProxyTss,
  toDayKey,
  type LoadWorkoutInput,
} from "@/training-load/load-series";

// --- Independent hand reference for the EWMA recurrence --------------------
// Mirrors the formula in load-series.ts so the test asserts against a value
// derived OUTSIDE the implementation, not the implementation echoing itself.
function handSeries(dailyTss: number[], seedCtl = 0, seedAtl = 0) {
  const ctlD = Math.exp(-1 / 42);
  const atlD = Math.exp(-1 / 7);
  let ctl = seedCtl;
  let atl = seedAtl;
  const out: { ctl: number; atl: number; tsb: number }[] = [];
  for (const tss of dailyTss) {
    const tsb = ctl - atl; // yesterday-relative
    ctl = ctl * ctlD + tss * (1 - ctlD);
    atl = atl * atlD + tss * (1 - atlD);
    out.push({ ctl, atl, tsb });
  }
  return out;
}

describe("date helpers", () => {
  it("toDayKey strips datetime to calendar day", () => {
    expect(toDayKey("2026-03-01T14:23:00Z")).toBe("2026-03-01");
    expect(toDayKey("2026-03-01")).toBe("2026-03-01");
  });

  it("dayDiff counts calendar days", () => {
    expect(dayDiff("2026-03-01", "2026-03-08")).toBe(7);
    expect(dayDiff("2026-03-08", "2026-03-01")).toBe(-7);
  });

  it("addDays advances and wraps months", () => {
    expect(addDays("2026-03-30", 3)).toBe("2026-04-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("toDayKey throws on garbage", () => {
    expect(() => toDayKey("not-a-date")).toThrow();
  });
});

describe("computeWorkoutTss — confidence tiers", () => {
  it("uses persisted power-TSS (canonical tss_equivalent first)", () => {
    const w: LoadWorkoutInput = {
      started_at: "2026-03-01T08:00:00Z",
      duration_s: 3600,
      summary_stats: { tss_equivalent: 88, tss: 70 },
    };
    expect(computeWorkoutTss(w)).toEqual({ date: "2026-03-01", tss: 88, confidence: "power" });
  });

  it("falls back to persisted `tss` key", () => {
    const w: LoadWorkoutInput = {
      started_at: "2026-03-01",
      duration_s: 3600,
      summary_stats: { tss: 64 },
    };
    expect(computeWorkoutTss(w)).toEqual({ date: "2026-03-01", tss: 64, confidence: "power" });
  });

  it("computes power-TSS live via training-math when np+ftp present", () => {
    // 1h at NP=FTP=265 → TSS 100, confidence power.
    const w: LoadWorkoutInput = {
      started_at: "2026-03-01",
      duration_s: 3600,
      summary_stats: { weighted_average_watts: 265, ftp_at_workout: 265 },
    };
    const r = computeWorkoutTss(w)!;
    expect(r.confidence).toBe("power");
    expect(r.tss).toBeCloseTo(100, 4);
  });

  it("falls back to conservative duration proxy when no power (confidence=duration)", () => {
    const w: LoadWorkoutInput = {
      started_at: "2026-03-01",
      duration_s: 3600,
      summary_stats: { average_heartrate: 150 }, // HR present but hrTSS unbuilt
    };
    const r = computeWorkoutTss(w)!;
    expect(r.confidence).toBe("duration");
    expect(r.tss).toBeCloseTo(42, 4); // DURATION_PROXY_TSS_PER_HOUR
  });

  it("duration proxy under-counts vs threshold power (conservative)", () => {
    expect(durationProxyTss(3600)).toBeLessThan(100); // 1h proxy < 1h@FTP
    expect(durationProxyTss(0)).toBe(0);
    expect(durationProxyTss(-5)).toBe(0);
  });

  it("excludes a workout with no usable signal (null)", () => {
    const w: LoadWorkoutInput = {
      started_at: "2026-03-01",
      duration_s: null,
      summary_stats: { average_heartrate: 140 },
    };
    expect(computeWorkoutTss(w)).toBeNull();
  });
});

describe("buildLoadSeries — happy path (12 weeks steady runs)", () => {
  it("matches hand-computed EWMA within tolerance", () => {
    const start = "2026-01-01";
    const workouts: LoadWorkoutInput[] = [];
    const daily: number[] = [];
    for (let i = 0; i < 84; i++) {
      workouts.push({
        started_at: addDays(start, i),
        duration_s: 3600,
        summary_stats: { tss: 60 },
      });
      daily.push(60);
    }
    const state = buildLoadSeries(workouts);
    const hand = handSeries(daily);
    const lastHand = hand[hand.length - 1];

    expect(state.series).toHaveLength(84);
    expect(state.ctl).toBeCloseTo(lastHand.ctl, 3);
    expect(state.atl).toBeCloseTo(lastHand.atl, 3);
    // Documented reference values from the hand recurrence.
    expect(state.ctl).toBeCloseTo(51.88, 1);
    expect(state.atl).toBeCloseTo(60.0, 1);
    // Forward-looking current TSB = today CTL − today ATL.
    expect(state.tsb).toBeCloseTo(51.88 - 60.0, 1);

    // CTL ramp/week = CTL_today − CTL_7-days-ago.
    const idx7 = state.series.length - 1 - 7;
    expect(state.ctlRampPerWeek).toBeCloseTo(
      state.series[state.series.length - 1].ctl - state.series[idx7].ctl,
      6
    );
    expect(state.ctlRampPerWeek).toBeGreaterThan(0);
    expect(state.ctlRampPerWeek).toBeLessThan(8); // sustainable, under the cap

    // 100% power confidence.
    expect(state.powerConfidenceRatio).toBe(1);

    // Every value finite.
    for (const p of state.series) {
      expect(Number.isFinite(p.ctl)).toBe(true);
      expect(Number.isFinite(p.atl)).toBe(true);
      expect(Number.isFinite(p.tsb)).toBe(true);
    }
  });

  it("yesterday-relative TSB: first day's tsb equals the seed (0)", () => {
    const state = buildLoadSeries([
      { started_at: "2026-01-01", duration_s: 3600, summary_stats: { tss: 60 } },
    ]);
    expect(state.series[0].tsb).toBe(0);
  });

  it("sums multiple workouts on the same day", () => {
    const state = buildLoadSeries([
      { started_at: "2026-01-01T07:00:00Z", duration_s: 3600, summary_stats: { tss: 40 } },
      { started_at: "2026-01-01T18:00:00Z", duration_s: 3600, summary_stats: { tss: 30 } },
    ]);
    expect(state.series[0].tss).toBe(70);
  });

  it("decays across rest days when asOf extends past the last workout", () => {
    const workouts: LoadWorkoutInput[] = [
      { started_at: "2026-01-01", duration_s: 3600, summary_stats: { tss: 100 } },
    ];
    const noExtend = buildLoadSeries(workouts);
    const extended = buildLoadSeries(workouts, { asOf: "2026-01-15" });
    expect(extended.series.length).toBeGreaterThan(noExtend.series.length);
    // ATL decays toward 0 over the rest days → form (TSB) climbs.
    expect(extended.tsb).toBeGreaterThan(noExtend.tsb);
    expect(extended.atl).toBeLessThan(noExtend.atl);
  });
});

describe("buildLoadSeries — sparse / manual edge", () => {
  it("no-power workouts produce a finite, conservative, duration-confident series", () => {
    // One 50-min run (3000s) every 3 days for 6 weeks, no power, no persisted TSS.
    const workouts: LoadWorkoutInput[] = [];
    for (let i = 0; i < 14; i++) {
      workouts.push({
        started_at: addDays("2026-02-01", i * 3),
        duration_s: 3000,
        summary_stats: { average_heartrate: 145 },
      });
    }
    const state = buildLoadSeries(workouts, { asOf: addDays("2026-02-01", 13 * 3) });
    expect(state.powerConfidenceRatio).toBe(0); // entirely duration-proxied
    // 3000s proxy = 35 TSS; spread thin over 3-day gaps keeps CTL modest.
    expect(state.ctl).toBeGreaterThan(0);
    expect(state.ctl).toBeLessThan(35); // never exceeds a single-day proxy value
    expect(Number.isFinite(state.tsb)).toBe(true);
    expect(Number.isFinite(state.ctlRampPerWeek)).toBe(true);
    for (const p of state.series) {
      expect(Number.isFinite(p.ctl) && Number.isFinite(p.atl) && Number.isFinite(p.tsb)).toBe(true);
    }
  });

  it("empty input returns a finite zero state", () => {
    const state = buildLoadSeries([]);
    expect(state).toEqual({
      series: [],
      ctl: 0,
      atl: 0,
      tsb: 0,
      ctlRampPerWeek: 0,
      powerConfidenceRatio: 0,
    });
  });

  it("mixed power + duration workouts report a partial confidence ratio", () => {
    const state = buildLoadSeries([
      { started_at: "2026-02-01", duration_s: 3600, summary_stats: { tss: 80 } },
      { started_at: "2026-02-02", duration_s: 3600, summary_stats: { average_heartrate: 150 } },
    ]);
    expect(state.powerConfidenceRatio).toBeCloseTo(0.5, 6);
  });
});

describe("buildLoadSeries — determinism", () => {
  it("is deterministic for a fixed fixture regardless of input order", () => {
    const a: LoadWorkoutInput[] = [
      { started_at: "2026-01-03", duration_s: 3600, summary_stats: { tss: 50 } },
      { started_at: "2026-01-01", duration_s: 3600, summary_stats: { tss: 70 } },
      { started_at: "2026-01-02", duration_s: 3600, summary_stats: { tss: 60 } },
    ];
    const b = [...a].reverse();
    expect(buildLoadSeries(a)).toEqual(buildLoadSeries(b));
  });
});
