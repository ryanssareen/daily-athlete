import { describe, expect, it } from "vitest";

import {
  DimensionDeltaSchema,
  DimensionStatusSchema,
  ExecutionDeltaSchema,
  IntensityDimensionDeltaSchema,
  ReportNarrationSchema,
  REPORT_NOTE_MAX_LENGTH,
  REPORT_TAKEAWAY_MAX_LENGTH,
  VerdictCodeSchema,
  WorkoutReportResponseSchema,
} from "../workout-report";

describe("VerdictCodeSchema", () => {
  it("accepts each documented verdict code", () => {
    for (const code of [
      "executed_as_prescribed",
      "under_executed",
      "over_executed",
      "partial_data",
      "unplanned_effort",
    ]) {
      expect(() => VerdictCodeSchema.parse(code)).not.toThrow();
    }
  });

  it("rejects an unknown verdict code (closed enum)", () => {
    expect(() => VerdictCodeSchema.parse("fully_crushed_it")).toThrow();
    expect(() => VerdictCodeSchema.parse("")).toThrow();
  });
});

describe("DimensionStatusSchema", () => {
  it("accepts each documented status", () => {
    for (const status of ["on_target", "under", "over", "unavailable"]) {
      expect(() => DimensionStatusSchema.parse(status)).not.toThrow();
    }
  });

  it("rejects an unknown status", () => {
    expect(() => DimensionStatusSchema.parse("way_off")).toThrow();
  });
});

describe("DimensionDeltaSchema", () => {
  it("parses a resolved on_target dimension with numbers", () => {
    const parsed = DimensionDeltaSchema.parse({
      status: "on_target",
      prescribed: 3600,
      actual: 3480,
      deltaPct: -3.3,
    });
    expect(parsed.status).toBe("on_target");
  });

  it("parses under/over with numbers", () => {
    expect(() =>
      DimensionDeltaSchema.parse({ status: "under", prescribed: 5400, actual: 2040, deltaPct: -62.2 }),
    ).not.toThrow();
    expect(() =>
      DimensionDeltaSchema.parse({ status: "over", prescribed: 3600, actual: 4200, deltaPct: 16.7 }),
    ).not.toThrow();
  });

  // Pins KTD8: a dimension that could not be resolved degrades to
  // `{status: "unavailable"}` alone -- prescribed/actual/deltaPct absent.
  it("parses an unavailable dimension with prescribed/actual/deltaPct all absent (KTD8)", () => {
    const parsed = DimensionDeltaSchema.parse({ status: "unavailable" });
    expect(parsed).toEqual({ status: "unavailable" });
  });

  it("rejects an unavailable dimension carrying stray numeric fields", () => {
    expect(() =>
      DimensionDeltaSchema.parse({ status: "unavailable", prescribed: 100 }),
    ).toThrow();
  });

  it("rejects a resolved dimension missing prescribed/actual/deltaPct", () => {
    expect(() => DimensionDeltaSchema.parse({ status: "on_target" })).toThrow();
    expect(() => DimensionDeltaSchema.parse({ status: "on_target", prescribed: 100 })).toThrow();
  });

  it("rejects non-finite numbers (no Infinity/NaN leaking into a delta)", () => {
    expect(() =>
      DimensionDeltaSchema.parse({ status: "over", prescribed: 0, actual: 100, deltaPct: Infinity }),
    ).toThrow();
    expect(() =>
      DimensionDeltaSchema.parse({ status: "over", prescribed: NaN, actual: 100, deltaPct: 1 }),
    ).toThrow();
  });

  it("rejects an unrecognized status", () => {
    expect(() =>
      DimensionDeltaSchema.parse({ status: "way_off", prescribed: 1, actual: 1, deltaPct: 0 }),
    ).toThrow();
  });
});

describe("IntensityDimensionDeltaSchema", () => {
  it("parses a resolved intensity dimension carrying its IntensityTarget", () => {
    const parsed = IntensityDimensionDeltaSchema.parse({
      status: "on_target",
      target: { kind: "ftp_pct", value: 75 },
      prescribed: 75,
      actual: 74,
      deltaPct: -1.3,
    });
    expect(parsed.status).toBe("on_target");
    if (parsed.status !== "unavailable") {
      expect(parsed.target).toEqual({ kind: "ftp_pct", value: 75 });
    }
  });

  it("accepts each IntensityTarget kind", () => {
    expect(() =>
      IntensityDimensionDeltaSchema.parse({
        status: "under",
        target: { kind: "zone", value: 3 },
        prescribed: 3,
        actual: 2,
        deltaPct: -33.3,
      }),
    ).not.toThrow();
    expect(() =>
      IntensityDimensionDeltaSchema.parse({
        status: "over",
        target: { kind: "pace_s_per_km", value: 240 },
        prescribed: 240,
        actual: 220,
        deltaPct: -8.3,
      }),
    ).not.toThrow();
  });

  it("parses unavailable with no target and no numbers (KTD8)", () => {
    const parsed = IntensityDimensionDeltaSchema.parse({ status: "unavailable" });
    expect(parsed).toEqual({ status: "unavailable" });
  });

  it("rejects a resolved intensity dimension missing target", () => {
    expect(() =>
      IntensityDimensionDeltaSchema.parse({ status: "on_target", prescribed: 75, actual: 74, deltaPct: -1.3 }),
    ).toThrow();
  });

  it("rejects an invalid IntensityTarget kind", () => {
    expect(() =>
      IntensityDimensionDeltaSchema.parse({
        status: "on_target",
        target: { kind: "watts", value: 250 },
        prescribed: 250,
        actual: 245,
        deltaPct: -2,
      }),
    ).toThrow();
  });
});

describe("ExecutionDeltaSchema", () => {
  const dims = {
    duration: { status: "on_target" as const, prescribed: 3600, actual: 3480, deltaPct: -3.3 },
    load: { status: "on_target" as const, prescribed: 55, actual: 61, deltaPct: 10.9 },
    intensity: { status: "unavailable" as const },
  };

  it("parses a matched delta with all three dimensions populated", () => {
    const parsed = ExecutionDeltaSchema.parse({
      matched: true,
      dimensions: {
        duration: dims.duration,
        load: dims.load,
        intensity: {
          status: "on_target",
          target: { kind: "ftp_pct", value: 75 },
          prescribed: 75,
          actual: 74,
          deltaPct: -1.3,
        },
      },
      verdict: { code: "executed_as_prescribed", headline: "Executed as prescribed" },
    });
    expect(parsed.matched).toBe(true);
  });

  it("parses a matched delta with an unavailable dimension mixed with resolved ones", () => {
    const parsed = ExecutionDeltaSchema.parse({
      matched: true,
      dimensions: dims,
      verdict: { code: "partial_data", headline: "Partial data" },
    });
    expect(parsed.matched).toBe(true);
  });

  // Pins the R4/AE3 unplanned-effort shape: no `dimensions` key at all.
  it("parses an unmatched delta with no dimensions key (R4/AE3)", () => {
    const parsed = ExecutionDeltaSchema.parse({
      matched: false,
      verdict: { code: "unplanned_effort", headline: "Unplanned effort" },
    });
    expect(parsed).toEqual({
      matched: false,
      verdict: { code: "unplanned_effort", headline: "Unplanned effort" },
    });
  });

  it("rejects an unmatched delta carrying a stray dimensions key", () => {
    expect(() =>
      ExecutionDeltaSchema.parse({
        matched: false,
        dimensions: dims,
        verdict: { code: "unplanned_effort", headline: "Unplanned effort" },
      }),
    ).toThrow();
  });

  it("rejects a matched delta missing dimensions", () => {
    expect(() =>
      ExecutionDeltaSchema.parse({
        matched: true,
        verdict: { code: "executed_as_prescribed", headline: "Executed as prescribed" },
      }),
    ).toThrow();
  });

  it("rejects a delta missing verdict", () => {
    expect(() => ExecutionDeltaSchema.parse({ matched: false })).toThrow();
  });

  it("rejects an unrecognized verdict code inside a delta", () => {
    expect(() =>
      ExecutionDeltaSchema.parse({
        matched: false,
        verdict: { code: "nailed_it", headline: "Nailed it" },
      }),
    ).toThrow();
  });
});

describe("ReportNarrationSchema", () => {
  it("parses a well-formed note + takeaway", () => {
    const parsed = ReportNarrationSchema.parse({
      note: "You hit the prescribed duration and load almost exactly.",
      takeaway: "Keep this pacing next interval session.",
    });
    expect(parsed.takeaway).toContain("pacing");
  });

  it("rejects a note exceeding the length cap", () => {
    expect(() =>
      ReportNarrationSchema.parse({
        note: "x".repeat(REPORT_NOTE_MAX_LENGTH + 1),
        takeaway: "Fine.",
      }),
    ).toThrow();
  });

  it("rejects a takeaway exceeding the length cap", () => {
    expect(() =>
      ReportNarrationSchema.parse({
        note: "Fine.",
        takeaway: "x".repeat(REPORT_TAKEAWAY_MAX_LENGTH + 1),
      }),
    ).toThrow();
  });

  it("rejects narration missing takeaway", () => {
    expect(() => ReportNarrationSchema.parse({ note: "Solid session." })).toThrow();
  });

  it("rejects narration missing note", () => {
    expect(() => ReportNarrationSchema.parse({ takeaway: "Keep it up." })).toThrow();
  });

  it("rejects an unexpected key (strict -- untrusted LLM output trust boundary)", () => {
    expect(() =>
      ReportNarrationSchema.parse({
        note: "Solid session.",
        takeaway: "Keep it up.",
        confidence: 0.9,
      }),
    ).toThrow();
  });

  it("rejects empty strings", () => {
    expect(() => ReportNarrationSchema.parse({ note: "", takeaway: "Keep it up." })).toThrow();
    expect(() => ReportNarrationSchema.parse({ note: "Solid.", takeaway: "" })).toThrow();
  });
});

describe("WorkoutReportResponseSchema", () => {
  const unmatchedDelta = {
    matched: false as const,
    verdict: { code: "unplanned_effort" as const, headline: "Unplanned effort" },
  };

  it("parses a response with no narrative yet (generatable, not stale)", () => {
    const parsed = WorkoutReportResponseSchema.parse({
      delta: unmatchedDelta,
      narration: null,
      stale: false,
      generatable: true,
    });
    expect(parsed.narration).toBeNull();
    expect(parsed.generatable).toBe(true);
  });

  it("parses a response with a fresh narrative", () => {
    const parsed = WorkoutReportResponseSchema.parse({
      delta: unmatchedDelta,
      narration: { note: "An easy unplanned spin.", takeaway: "No action needed." },
      stale: false,
      generatable: true,
    });
    expect(parsed.narration?.note).toContain("unplanned");
  });

  // Covers AE5.
  it("parses a response with a stale narrative", () => {
    const parsed = WorkoutReportResponseSchema.parse({
      delta: unmatchedDelta,
      narration: { note: "An easy unplanned spin.", takeaway: "No action needed." },
      stale: true,
      generatable: true,
    });
    expect(parsed.stale).toBe(true);
  });

  it("rejects a response missing delta", () => {
    expect(() =>
      WorkoutReportResponseSchema.parse({ narration: null, stale: false, generatable: true }),
    ).toThrow();
  });

  it("rejects a response with an invalid delta nested inside it", () => {
    expect(() =>
      WorkoutReportResponseSchema.parse({
        delta: { matched: true, verdict: { code: "executed_as_prescribed", headline: "OK" } },
        narration: null,
        stale: false,
        generatable: true,
      }),
    ).toThrow();
  });

  it("accepts an optional retryable flag on a failed-generation response", () => {
    expect(
      WorkoutReportResponseSchema.parse({
        delta: unmatchedDelta,
        narration: null,
        stale: false,
        generatable: true,
        retryable: false,
      }),
    ).toMatchObject({ retryable: false });
  });

  it("accepts an optional verdictChanged flag alongside a stored narration", () => {
    expect(
      WorkoutReportResponseSchema.parse({
        delta: unmatchedDelta,
        narration: { note: "An older note.", takeaway: "An older takeaway." },
        stale: true,
        generatable: true,
        verdictChanged: true,
      }),
    ).toMatchObject({ verdictChanged: true, stale: true });
  });

  it("accepts a failed regeneration that still carries the previously stored narration", () => {
    // The route writes no row on a narration failure, so the stored note is
    // still the truth -- returning it alongside `retryable` is what keeps a
    // failed refresh from wiping prose off the athlete's screen.
    expect(
      WorkoutReportResponseSchema.parse({
        delta: unmatchedDelta,
        narration: { note: "Still stored.", takeaway: "Still stored." },
        stale: true,
        generatable: true,
        retryable: true,
      }),
    ).toMatchObject({ retryable: true, narration: { note: "Still stored." } });
  });

  it("rejects an unknown sibling key", () => {
    expect(() =>
      WorkoutReportResponseSchema.parse({
        delta: unmatchedDelta,
        narration: null,
        stale: false,
        generatable: true,
        bogus: true,
      }),
    ).toThrow();
  });
});
