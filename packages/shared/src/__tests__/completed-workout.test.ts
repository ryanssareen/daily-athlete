import { describe, expect, it } from "vitest";

import {
  CompletedWorkoutRowSchema,
  CompletedWorkoutSourceSchema,
  SummaryStatsSchema,
} from "../completed-workout";

describe("CompletedWorkoutSourceSchema", () => {
  it("accepts each documented source", () => {
    expect(CompletedWorkoutSourceSchema.parse("strava")).toBe("strava");
    expect(CompletedWorkoutSourceSchema.parse("manual")).toBe("manual");
  });

  it("rejects unknown sources", () => {
    expect(() => CompletedWorkoutSourceSchema.parse("healthkit")).toThrow();
    expect(() => CompletedWorkoutSourceSchema.parse("")).toThrow();
  });
});

describe("SummaryStatsSchema", () => {
  it("accepts empty object (DB default)", () => {
    expect(() => SummaryStatsSchema.parse({})).not.toThrow();
  });

  it("accepts arbitrary nested shapes (passthrough)", () => {
    expect(() =>
      SummaryStatsSchema.parse({
        avg_hr_bpm: 148,
        max_hr_bpm: 178,
        avg_power_w: 220,
        normalized_power_w: 235,
        tss_equivalent: 65.5,
        zones_hr: { z1: 120, z2: 600, z3: 1200, z4: 200, z5: 0 },
      }),
    ).not.toThrow();
  });

  it("rejects non-object payloads", () => {
    expect(() => SummaryStatsSchema.parse("string")).toThrow();
    expect(() => SummaryStatsSchema.parse(42)).toThrow();
    expect(() => SummaryStatsSchema.parse(null)).toThrow();
    expect(() => SummaryStatsSchema.parse([])).toThrow();
  });
});

describe("CompletedWorkoutRowSchema", () => {
  const stravaRow = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    athlete_id: "660e8400-e29b-41d4-a716-446655440001",
    source: "strava",
    strava_activity_id: 12345678901,
    started_at: "2026-05-13T06:30:00+00:00",
    sport: "run",
    distance_m: 10000,
    duration_s: 2700,
    summary_stats: { avg_hr_bpm: 148, tss_equivalent: 55 },
    superseded_by_id: null,
    created_at: "2026-05-13T06:35:12+00:00",
    deleted_at: null,
  };

  it("parses a fully-populated Strava row", () => {
    const parsed = CompletedWorkoutRowSchema.parse(stravaRow);
    expect(parsed.source).toBe("strava");
    expect(parsed.strava_activity_id).toBe(12345678901);
    expect(parsed.distance_m).toBe(10000);
  });

  it("accepts a manual row with NULL strava_activity_id", () => {
    const parsed = CompletedWorkoutRowSchema.parse({
      ...stravaRow,
      source: "manual",
      strava_activity_id: null,
    });
    expect(parsed.source).toBe("manual");
    expect(parsed.strava_activity_id).toBeNull();
  });

  it("accepts a soft-deleted row", () => {
    const parsed = CompletedWorkoutRowSchema.parse({
      ...stravaRow,
      deleted_at: "2026-05-14T00:00:00+00:00",
    });
    expect(parsed.deleted_at).toBe("2026-05-14T00:00:00+00:00");
  });

  it("accepts a superseded row (R21 manual->Strava merge trail)", () => {
    const parsed = CompletedWorkoutRowSchema.parse({
      ...stravaRow,
      source: "manual",
      strava_activity_id: null,
      superseded_by_id: "770e8400-e29b-41d4-a716-446655440002",
    });
    expect(parsed.superseded_by_id).toBe("770e8400-e29b-41d4-a716-446655440002");
  });

  it("accepts a sparse manual row (distance_m and duration_s both NULL)", () => {
    const parsed = CompletedWorkoutRowSchema.parse({
      ...stravaRow,
      source: "manual",
      strava_activity_id: null,
      distance_m: null,
      duration_s: null,
    });
    expect(parsed.distance_m).toBeNull();
    expect(parsed.duration_s).toBeNull();
  });

  it("accepts each documented sport", () => {
    for (const sport of [
      "swim",
      "bike",
      "run",
      "strength",
      "mobility",
      "other",
    ]) {
      expect(() =>
        CompletedWorkoutRowSchema.parse({ ...stravaRow, sport }),
      ).not.toThrow();
    }
  });

  it("rejects unknown sport", () => {
    expect(() =>
      CompletedWorkoutRowSchema.parse({ ...stravaRow, sport: "rowing" }),
    ).toThrow();
  });

  it("rejects unknown source", () => {
    expect(() =>
      CompletedWorkoutRowSchema.parse({ ...stravaRow, source: "healthkit" }),
    ).toThrow();
  });

  it("rejects malformed UUIDs", () => {
    expect(() =>
      CompletedWorkoutRowSchema.parse({ ...stravaRow, id: "not-a-uuid" }),
    ).toThrow();
    expect(() =>
      CompletedWorkoutRowSchema.parse({
        ...stravaRow,
        athlete_id: "not-a-uuid",
      }),
    ).toThrow();
    expect(() =>
      CompletedWorkoutRowSchema.parse({
        ...stravaRow,
        superseded_by_id: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("rejects non-integer strava_activity_id", () => {
    expect(() =>
      CompletedWorkoutRowSchema.parse({
        ...stravaRow,
        strava_activity_id: 12345.6,
      }),
    ).toThrow();
  });

  it("rejects non-integer duration_s", () => {
    expect(() =>
      CompletedWorkoutRowSchema.parse({ ...stravaRow, duration_s: 2700.5 }),
    ).toThrow();
  });

  it("accepts fractional distance_m (NUMERIC)", () => {
    expect(() =>
      CompletedWorkoutRowSchema.parse({ ...stravaRow, distance_m: 10042.7 }),
    ).not.toThrow();
  });

  it("rejects string for numeric fields", () => {
    expect(() =>
      CompletedWorkoutRowSchema.parse({ ...stravaRow, distance_m: "10000" }),
    ).toThrow();
  });

  it("accepts timestamps with offset notation", () => {
    expect(() =>
      CompletedWorkoutRowSchema.parse({
        ...stravaRow,
        started_at: "2026-05-13T06:30:00.123456+00:00",
      }),
    ).not.toThrow();
  });

  it("rejects rows missing required fields", () => {
    const { athlete_id, ...withoutAthleteId } = stravaRow;
    expect(() => CompletedWorkoutRowSchema.parse(withoutAthleteId)).toThrow();
    const { source, ...withoutSource } = stravaRow;
    expect(() => CompletedWorkoutRowSchema.parse(withoutSource)).toThrow();
    const { started_at, ...withoutStartedAt } = stravaRow;
    expect(() => CompletedWorkoutRowSchema.parse(withoutStartedAt)).toThrow();
    const { sport, ...withoutSport } = stravaRow;
    expect(() => CompletedWorkoutRowSchema.parse(withoutSport)).toThrow();
    const { created_at, ...withoutCreatedAt } = stravaRow;
    expect(() => CompletedWorkoutRowSchema.parse(withoutCreatedAt)).toThrow();
  });
});
