import { describe, expect, it } from "vitest";

import {
  computeExecutionDelta,
  DURATION_TOLERANCE_PCT,
  INTENSITY_TOLERANCE_PCT,
  LOAD_TOLERANCE_PCT,
  type DeltaCompletedWorkoutInput,
  type DeltaInput,
  type DeltaPlannedWorkoutInput,
} from "@/ai/reports/delta";

function completed(over: Partial<DeltaCompletedWorkoutInput> = {}): DeltaCompletedWorkoutInput {
  return {
    duration_s: 3600,
    distance_m: 10000,
    sport: "ride",
    summary_stats: {},
    ...over,
  };
}

function planned(over: Partial<DeltaPlannedWorkoutInput> = {}): DeltaPlannedWorkoutInput {
  return {
    sport: "ride",
    planned_load: null,
    structure: {},
    ...over,
  };
}

function matched(
  completedOver: Partial<DeltaCompletedWorkoutInput> = {},
  plannedOver: Partial<DeltaPlannedWorkoutInput> = {}
): DeltaInput {
  return { matched: true, completed: completed(completedOver), planned: planned(plannedOver) };
}

describe("computeExecutionDelta — matched: false (R4 / AE3)", () => {
  it("short-circuits every dimension to absent with verdict unplanned_effort", () => {
    const input: DeltaInput = { matched: false, completed: completed() };
    const delta = computeExecutionDelta(input);

    expect(delta.matched).toBe(false);
    expect(delta).not.toHaveProperty("dimensions");
    expect(delta.verdict.code).toBe("unplanned_effort");
    expect(delta.verdict.headline.length).toBeGreaterThan(0);
  });
});

describe("computeExecutionDelta — AE1 (executed as prescribed)", () => {
  it("prescribed 3600s/load 55/75% FTP; actual 3480s/TSS 61/76% FTP -> all on_target, executed_as_prescribed", () => {
    const input = matched(
      {
        duration_s: 3480,
        summary_stats: { tss: 61, ftp_at_workout: 250, normalized_power_w: 190 },
      },
      {
        planned_load: 55,
        structure: { duration_s: 3600, intensity_target: { kind: "ftp_pct", value: 75 } },
      }
    );

    const delta = computeExecutionDelta(input);
    expect(delta.matched).toBe(true);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.duration.status).toBe("on_target");
    expect(delta.dimensions.load.status).toBe("on_target");
    expect(delta.dimensions.intensity.status).toBe("on_target");
    expect(delta.verdict.code).toBe("executed_as_prescribed");
  });
});

describe("computeExecutionDelta — AE2 (materially under-executed)", () => {
  it("prescribed 5400s; actual 2040s -> duration under, verdict under_executed", () => {
    const input = matched(
      { duration_s: 2040 },
      { structure: { duration_s: 5400 } }
    );

    const delta = computeExecutionDelta(input);
    expect(delta.matched).toBe(true);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.duration.status).toBe("under");
    expect(delta.verdict.code).toBe("under_executed");
  });
});

describe("computeExecutionDelta — partial prescription (KTD8)", () => {
  it("missing intensity_target -> intensity unavailable, other dimensions still computed", () => {
    const input = matched(
      { duration_s: 3600, summary_stats: { tss: 55 } },
      { planned_load: 55, structure: { duration_s: 3600 } }
    );

    const delta = computeExecutionDelta(input);
    expect(delta.matched).toBe(true);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.intensity).toEqual({ status: "unavailable" });
    expect(delta.dimensions.duration.status).toBe("on_target");
    expect(delta.dimensions.load.status).toBe("on_target");
  });

  it("verdict is NOT partial_data when the available dimensions agree despite the missing one", () => {
    const input = matched(
      { duration_s: 3600, summary_stats: { tss: 55 } },
      { planned_load: 55, structure: { duration_s: 3600 } }
    );

    const delta = computeExecutionDelta(input);
    expect(delta.verdict.code).toBe("executed_as_prescribed");
  });

  it("verdict IS partial_data when the missing dimension would have decided a conflicting outcome", () => {
    // duration far under, load far over, intensity_target absent -- the
    // available dimensions disagree, so the missing one could have tipped it.
    const input = matched(
      { duration_s: 1800, summary_stats: { tss: 100 } },
      { planned_load: 50, structure: { duration_s: 3600 } }
    );

    const delta = computeExecutionDelta(input);
    expect(delta.matched).toBe(true);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.duration.status).toBe("under");
    expect(delta.dimensions.load.status).toBe("over");
    expect(delta.verdict.code).toBe("partial_data");
  });

  it("all three dimensions unavailable -> partial_data", () => {
    const input = matched({ duration_s: null, summary_stats: {} }, { planned_load: null, structure: {} });

    const delta = computeExecutionDelta(input);
    expect(delta.matched).toBe(true);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.duration).toEqual({ status: "unavailable" });
    expect(delta.dimensions.load).toEqual({ status: "unavailable" });
    expect(delta.dimensions.intensity).toEqual({ status: "unavailable" });
    expect(delta.verdict.code).toBe("partial_data");
  });
});

describe("computeExecutionDelta — load dimension", () => {
  it("summary_stats has neither tss nor tss_equivalent -> load unavailable", () => {
    const input = matched({ summary_stats: { average_heartrate: 140 } }, { planned_load: 55 });

    const delta = computeExecutionDelta(input);
    expect(delta.matched).toBe(true);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.load).toEqual({ status: "unavailable" });
  });

  it("falls back to tss when tss_equivalent is absent", () => {
    const input = matched({ summary_stats: { tss: 55 } }, { planned_load: 55 });

    const delta = computeExecutionDelta(input);
    expect(delta.matched).toBe(true);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.load.status).toBe("on_target");
  });

  it("prefers canonical tss_equivalent over legacy tss when both are present", () => {
    // Matches training-load/load-series.ts persistedTss ordering. tss_equivalent=55
    // exactly matches planned_load=55 (on_target); the legacy tss=1000 would blow
    // the tolerance if it were read instead.
    const input = matched({ summary_stats: { tss_equivalent: 55, tss: 1000 } }, { planned_load: 55 });

    const delta = computeExecutionDelta(input);
    expect(delta.matched).toBe(true);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.load).toMatchObject({ status: "on_target", actual: 55 });
  });

  // PRESCRIBED side. `structure.load` is what context.ts and
  // ai/adaptive/context.ts both treat as authoritative; the `planned_load`
  // column is the fallback. Coach- and MCP-authored planned workouts put
  // their load in `structure` and may leave the column null, so reading only
  // the column dropped the load dimension entirely for them.
  it("prefers structure.load over the planned_load column", () => {
    // structure.load=55 matches the actual (on_target); the column's 1000
    // would be wildly under if it were read instead.
    const input = matched(
      { summary_stats: { tss_equivalent: 55 } },
      { planned_load: 1000, structure: { load: 55 } }
    );

    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.load).toMatchObject({ status: "on_target", prescribed: 55 });
  });

  it("falls back to the planned_load column when structure.load is absent", () => {
    const input = matched({ summary_stats: { tss_equivalent: 55 } }, { planned_load: 55, structure: {} });

    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.load).toMatchObject({ status: "on_target", prescribed: 55 });
  });

  it("a coach-authored workout with load ONLY in structure still gets a load dimension", () => {
    const input = matched(
      { summary_stats: { tss_equivalent: 80 } },
      { planned_load: null, structure: { load: 80 } }
    );

    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    // The regression: this was `{status: "unavailable"}` when only the
    // planned_load column was read.
    expect(delta.dimensions.load.status).toBe("on_target");
  });
});

describe("computeExecutionDelta — intensity dimension (KTD7 snapshotted thresholds)", () => {
  it("ftp_pct with ftp_at_workout absent -> intensity unavailable, no NaN/Infinity", () => {
    const input = matched(
      { summary_stats: { normalized_power_w: 200 } },
      { structure: { intensity_target: { kind: "ftp_pct", value: 75 } } }
    );

    const delta = computeExecutionDelta(input);
    expect(delta.matched).toBe(true);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.intensity).toEqual({ status: "unavailable" });
  });

  it("zone target resolves against hr_max_at_workout (snapshotted), not a live threshold", () => {
    const input = matched(
      { summary_stats: { avg_hr_bpm: 150, hr_max_at_workout: 200 } },
      { structure: { intensity_target: { kind: "zone", value: 3 } } }
    );

    const delta = computeExecutionDelta(input);
    expect(delta.matched).toBe(true);
    if (!delta.matched) throw new Error("unreachable");

    // actual %HRmax = 150/200*100 = 75, zone 3 midpoint = 75 -> exact match.
    expect(delta.dimensions.intensity.status).toBe("on_target");
  });

  it("pace_s_per_km: running FASTER (lower s/km) than prescribed counts as over, not under", () => {
    const input = matched(
      { summary_stats: { avg_pace_s_per_km: 240 } }, // faster than prescribed
      { structure: { intensity_target: { kind: "pace_s_per_km", value: 300 } } }
    );

    const delta = computeExecutionDelta(input);
    expect(delta.matched).toBe(true);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.intensity.status).toBe("over");
    if (delta.dimensions.intensity.status === "unavailable") throw new Error("unreachable");
    expect(delta.dimensions.intensity.deltaPct).toBeGreaterThan(0);
  });

  it("pace_s_per_km: running SLOWER (higher s/km) than prescribed counts as under", () => {
    const input = matched(
      { summary_stats: { avg_pace_s_per_km: 360 } }, // slower than prescribed
      { structure: { intensity_target: { kind: "pace_s_per_km", value: 300 } } }
    );

    const delta = computeExecutionDelta(input);
    expect(delta.matched).toBe(true);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.intensity.status).toBe("under");
    if (delta.dimensions.intensity.status === "unavailable") throw new Error("unreachable");
    expect(delta.dimensions.intensity.deltaPct).toBeLessThan(0);
  });

  it("carries the original IntensityTarget on a resolvable branch", () => {
    const target = { kind: "ftp_pct" as const, value: 75 };
    const input = matched(
      { summary_stats: { ftp_at_workout: 250, normalized_power_w: 190 } },
      { structure: { intensity_target: target } }
    );

    const delta = computeExecutionDelta(input);
    expect(delta.matched).toBe(true);
    if (!delta.matched) throw new Error("unreachable");
    if (delta.dimensions.intensity.status === "unavailable") throw new Error("unreachable");

    expect(delta.dimensions.intensity.target).toEqual(target);
  });
});

describe("computeExecutionDelta — pace intensity resolution", () => {
  const paceTarget = { structure: { intensity_target: { kind: "pace_s_per_km", value: 300 } as const } };

  it("reads the canonical avg_pace_s_per_km when present", () => {
    const input = matched({ summary_stats: { avg_pace_s_per_km: 300 } }, paceTarget);
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.intensity).toMatchObject({ status: "on_target", prescribed: 300, actual: 300 });
  });

  // THE REGRESSION: nothing in the ingest path writes avg_pace_s_per_km.
  // Strava sync stores `average_speed` in m/s, so before the fallback every
  // pace-prescribed run resolved to "unavailable" and the dimension could
  // never fire in production.
  it("derives pace from Strava's average_speed (m/s) when the canonical key is absent", () => {
    // 3.3333 m/s == 300 s/km.
    const input = matched({ summary_stats: { average_speed: 1000 / 300 } }, paceTarget);
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.intensity.status).toBe("on_target");
    if (delta.dimensions.intensity.status === "unavailable") throw new Error("unreachable");
    expect(delta.dimensions.intensity.actual).toBeCloseTo(300, 6);
  });

  it("falls back to distance + duration when neither a pace nor a speed is stored", () => {
    // 10km in 3000s == 300 s/km.
    const input = matched({ distance_m: 10000, duration_s: 3000, summary_stats: {} }, paceTarget);
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.intensity).toMatchObject({ status: "on_target", actual: 300 });
  });

  it("prefers the canonical key over a contradicting average_speed", () => {
    const input = matched(
      { summary_stats: { avg_pace_s_per_km: 300, average_speed: 10 } },
      paceTarget
    );
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.intensity).toMatchObject({ actual: 300 });
  });

  it("a zero speed does not produce Infinity — the dimension degrades", () => {
    const input = matched(
      { distance_m: null, duration_s: null, summary_stats: { average_speed: 0 } },
      paceTarget
    );
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.intensity).toEqual({ status: "unavailable" });
  });

  it("zero distance does not produce Infinity — the dimension degrades", () => {
    const input = matched({ distance_m: 0, duration_s: 3000, summary_stats: {} }, paceTarget);
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.intensity).toEqual({ status: "unavailable" });
  });

  it("keeps the inverted sign: running FASTER than prescribed reads as 'over'", () => {
    // 270 s/km actual vs 300 prescribed = 10% faster = harder effort.
    const input = matched({ summary_stats: { avg_pace_s_per_km: 270 } }, paceTarget);
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");
    if (delta.dimensions.intensity.status === "unavailable") throw new Error("unreachable");

    expect(delta.dimensions.intensity.status).toBe("over");
    expect(delta.dimensions.intensity.deltaPct).toBeCloseTo(10, 6);
  });
});

describe("computeExecutionDelta — tolerance boundaries (inclusive/exclusive)", () => {
  it(`duration deltaPct exactly +${DURATION_TOLERANCE_PCT}% is on_target (inclusive boundary)`, () => {
    // 3600 * 1.10 = 3960 -> deltaPct === 10 exactly.
    const input = matched({ duration_s: 3960 }, { structure: { duration_s: 3600 } });
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.duration).toMatchObject({ status: "on_target", deltaPct: 10 });
  });

  it(`duration deltaPct just over +${DURATION_TOLERANCE_PCT}% is "over" (exclusive past the boundary)`, () => {
    const input = matched({ duration_s: 3961 }, { structure: { duration_s: 3600 } });
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.duration.status).toBe("over");
  });

  it(`duration deltaPct exactly -${DURATION_TOLERANCE_PCT}% is on_target (inclusive boundary)`, () => {
    // 3600 * 0.90 = 3240 -> deltaPct === -10 exactly.
    const input = matched({ duration_s: 3240 }, { structure: { duration_s: 3600 } });
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.duration).toMatchObject({ status: "on_target", deltaPct: -10 });
  });

  it(`duration deltaPct just under -${DURATION_TOLERANCE_PCT}% is "under" (exclusive past the boundary)`, () => {
    const input = matched({ duration_s: 3239 }, { structure: { duration_s: 3600 } });
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.duration.status).toBe("under");
  });

  it(`load deltaPct exactly +${LOAD_TOLERANCE_PCT}% is on_target`, () => {
    // 55 * 1.15 = 63.25.
    const input = matched({ summary_stats: { tss: 63.25 } }, { planned_load: 55 });
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.load).toMatchObject({ status: "on_target", deltaPct: 15 });
  });

  it(`intensity deltaPct exactly +${INTENSITY_TOLERANCE_PCT}% is on_target`, () => {
    // ftp target 75, threshold 200 -> actual power 75*1.08=81% -> 162W.
    const input = matched(
      { summary_stats: { ftp_at_workout: 200, normalized_power_w: 162 } },
      { structure: { intensity_target: { kind: "ftp_pct", value: 75 } } }
    );
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");
    if (delta.dimensions.intensity.status === "unavailable") throw new Error("unreachable");

    expect(delta.dimensions.intensity.status).toBe("on_target");
    expect(delta.dimensions.intensity.deltaPct).toBeCloseTo(8, 10);
  });
});

describe("computeExecutionDelta — zero-valued prescriptions (no Infinity/NaN)", () => {
  it("zero-load prescription, zero actual -> on_target, deltaPct 0", () => {
    const input = matched({ summary_stats: { tss: 0 } }, { planned_load: 0 });
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.load).toEqual({ status: "on_target", prescribed: 0, actual: 0, deltaPct: 0 });
  });

  it("zero-load prescription, nonzero actual -> finite sentinel deltaPct, status over, no Infinity/NaN", () => {
    const input = matched({ summary_stats: { tss: 50 } }, { planned_load: 0 });
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    expect(delta.dimensions.load.status).toBe("over");
    if (delta.dimensions.load.status === "unavailable") throw new Error("unreachable");
    expect(Number.isFinite(delta.dimensions.load.deltaPct)).toBe(true);
    expect(Number.isNaN(delta.dimensions.load.deltaPct)).toBe(false);
  });

  it("zero-duration prescription, nonzero actual -> finite sentinel deltaPct, no Infinity/NaN", () => {
    const input = matched({ duration_s: 600 }, { structure: { duration_s: 0 } });
    const delta = computeExecutionDelta(input);
    if (!delta.matched) throw new Error("unreachable");

    if (delta.dimensions.duration.status === "unavailable") throw new Error("unreachable");
    expect(Number.isFinite(delta.dimensions.duration.deltaPct)).toBe(true);
    expect(Number.isNaN(delta.dimensions.duration.deltaPct)).toBe(false);
  });
});

describe("computeExecutionDelta — determinism", () => {
  it("same input twice returns a deeply-equal result", () => {
    const input = matched(
      {
        duration_s: 3480,
        summary_stats: { tss: 61, ftp_at_workout: 250, normalized_power_w: 190 },
      },
      {
        planned_load: 55,
        structure: { duration_s: 3600, intensity_target: { kind: "ftp_pct", value: 75 } },
      }
    );

    const first = computeExecutionDelta(input);
    const second = computeExecutionDelta(input);

    expect(first).toEqual(second);
  });

  it("is deterministic for the unmatched branch too", () => {
    const input: DeltaInput = { matched: false, completed: completed() };
    expect(computeExecutionDelta(input)).toEqual(computeExecutionDelta(input));
  });
});
