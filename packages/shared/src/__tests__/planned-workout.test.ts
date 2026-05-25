import { describe, expect, it } from "vitest";

import {
  EditedByKindSchema,
  PlannedWorkoutRowSchema,
  PlannedWorkoutStatusSchema,
  PlannedWorkoutStructureSchema,
  SportSchema,
} from "../planned-workout";

describe("SportSchema", () => {
  it("accepts each v1 sport", () => {
    for (const sport of [
      "swim",
      "bike",
      "run",
      "strength",
      "mobility",
      "other",
    ]) {
      expect(SportSchema.parse(sport)).toBe(sport);
    }
  });

  it("rejects other sport values", () => {
    expect(() => SportSchema.parse("rowing")).toThrow();
    expect(() => SportSchema.parse("yoga")).toThrow();
    expect(() => SportSchema.parse("")).toThrow();
  });
});

describe("PlannedWorkoutStatusSchema", () => {
  it("accepts each documented status", () => {
    for (const s of ["planned", "completed", "skipped", "moved"]) {
      expect(PlannedWorkoutStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects other status values", () => {
    expect(() => PlannedWorkoutStatusSchema.parse("in_progress")).toThrow();
    expect(() => PlannedWorkoutStatusSchema.parse("active")).toThrow();
  });
});

describe("EditedByKindSchema", () => {
  it("accepts each v1 kind", () => {
    expect(EditedByKindSchema.parse("athlete")).toBe("athlete");
    expect(EditedByKindSchema.parse("coach")).toBe("coach");
    expect(EditedByKindSchema.parse("ai_review")).toBe("ai_review");
  });

  it("rejects other kinds", () => {
    expect(() => EditedByKindSchema.parse("system")).toThrow();
    expect(() => EditedByKindSchema.parse("admin")).toThrow();
  });
});

describe("PlannedWorkoutStructureSchema", () => {
  it("accepts an empty object", () => {
    expect(() => PlannedWorkoutStructureSchema.parse({})).not.toThrow();
  });

  it("accepts arbitrary nested shapes (passthrough)", () => {
    expect(() =>
      PlannedWorkoutStructureSchema.parse({
        warmup: { duration_min: 10, intensity: "easy" },
        main: {
          intervals: [
            { reps: 5, duration_s: 180, target_pace_s_per_km: 240 },
          ],
        },
        cooldown: { duration_min: 5 },
      }),
    ).not.toThrow();
  });

  it("rejects non-object payloads", () => {
    expect(() => PlannedWorkoutStructureSchema.parse("string")).toThrow();
    expect(() => PlannedWorkoutStructureSchema.parse(42)).toThrow();
    expect(() => PlannedWorkoutStructureSchema.parse(null)).toThrow();
  });
});

describe("PlannedWorkoutRowSchema", () => {
  const baseRow = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    athlete_id: "660e8400-e29b-41d4-a716-446655440001",
    plan_id: "770e8400-e29b-41d4-a716-446655440002",
    scheduled_date: "2026-05-20",
    sport: "run",
    structure: { warmup: { duration_min: 10 } },
    planned_load: 65.5,
    status: "planned",
    rationale: "Recovery jog after long ride.",
    edited_by_kind: null,
    edited_by_user_id: null,
    edited_at: null,
    version: 1,
    created_at: "2026-05-13T10:30:00+00:00",
    deleted_at: null,
  };

  it("parses a fully-populated plan-attached workout", () => {
    const parsed = PlannedWorkoutRowSchema.parse(baseRow);
    expect(parsed.sport).toBe("run");
    expect(parsed.status).toBe("planned");
    expect(parsed.plan_id).toBe("770e8400-e29b-41d4-a716-446655440002");
  });

  it("accepts an ad-hoc workout (plan_id: null)", () => {
    const parsed = PlannedWorkoutRowSchema.parse({ ...baseRow, plan_id: null });
    expect(parsed.plan_id).toBeNull();
  });

  it("accepts an unedited workout (all three attribution fields null)", () => {
    const parsed = PlannedWorkoutRowSchema.parse({
      ...baseRow,
      edited_by_kind: null,
      edited_by_user_id: null,
      edited_at: null,
    });
    expect(parsed.edited_by_kind).toBeNull();
  });

  it("accepts an edited workout with all attribution fields set", () => {
    const parsed = PlannedWorkoutRowSchema.parse({
      ...baseRow,
      edited_by_kind: "coach",
      edited_by_user_id: "880e8400-e29b-41d4-a716-446655440003",
      edited_at: "2026-05-14T15:00:00+00:00",
    });
    expect(parsed.edited_by_kind).toBe("coach");
  });

  it("accepts a soft-deleted workout", () => {
    const parsed = PlannedWorkoutRowSchema.parse({
      ...baseRow,
      deleted_at: "2026-05-15T00:00:00+00:00",
    });
    expect(parsed.deleted_at).toBe("2026-05-15T00:00:00+00:00");
  });

  it("accepts planned_load as numeric and as null", () => {
    expect(() =>
      PlannedWorkoutRowSchema.parse({ ...baseRow, planned_load: 0 }),
    ).not.toThrow();
    expect(() =>
      PlannedWorkoutRowSchema.parse({ ...baseRow, planned_load: 150 }),
    ).not.toThrow();
    expect(() =>
      PlannedWorkoutRowSchema.parse({ ...baseRow, planned_load: null }),
    ).not.toThrow();
  });

  it("rejects planned_load as a string", () => {
    expect(() =>
      PlannedWorkoutRowSchema.parse({ ...baseRow, planned_load: "65" }),
    ).toThrow();
  });

  it("rejects rows with unknown sport", () => {
    expect(() =>
      PlannedWorkoutRowSchema.parse({ ...baseRow, sport: "rowing" }),
    ).toThrow();
  });

  it("rejects rows with unknown status", () => {
    expect(() =>
      PlannedWorkoutRowSchema.parse({ ...baseRow, status: "in_progress" }),
    ).toThrow();
  });

  it("rejects edited_by_kind values outside the v1 vocabulary", () => {
    expect(() =>
      PlannedWorkoutRowSchema.parse({
        ...baseRow,
        edited_by_kind: "system",
      }),
    ).toThrow();
  });

  it("rejects malformed UUIDs", () => {
    expect(() =>
      PlannedWorkoutRowSchema.parse({ ...baseRow, id: "not-a-uuid" }),
    ).toThrow();
    expect(() =>
      PlannedWorkoutRowSchema.parse({ ...baseRow, plan_id: "not-a-uuid" }),
    ).toThrow();
    expect(() =>
      PlannedWorkoutRowSchema.parse({
        ...baseRow,
        edited_by_user_id: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("accepts scheduled_date as ISO date string", () => {
    expect(() =>
      PlannedWorkoutRowSchema.parse({ ...baseRow, scheduled_date: "2026-12-31" }),
    ).not.toThrow();
  });

  it("rejects scheduled_date as a non-string", () => {
    expect(() =>
      PlannedWorkoutRowSchema.parse({ ...baseRow, scheduled_date: 20260520 }),
    ).toThrow();
  });

  it("accepts timestamps with offset notation", () => {
    expect(() =>
      PlannedWorkoutRowSchema.parse({
        ...baseRow,
        created_at: "2026-05-13T10:30:00.123456+00:00",
      }),
    ).not.toThrow();
  });

  it("rejects rows missing required fields", () => {
    const { athlete_id, ...withoutAthleteId } = baseRow;
    expect(() => PlannedWorkoutRowSchema.parse(withoutAthleteId)).toThrow();
    const { scheduled_date, ...withoutDate } = baseRow;
    expect(() => PlannedWorkoutRowSchema.parse(withoutDate)).toThrow();
    const { sport, ...withoutSport } = baseRow;
    expect(() => PlannedWorkoutRowSchema.parse(withoutSport)).toThrow();
    const { status, ...withoutStatus } = baseRow;
    expect(() => PlannedWorkoutRowSchema.parse(withoutStatus)).toThrow();
  });

  it("accepts an empty structure object (default JSONB value)", () => {
    expect(() =>
      PlannedWorkoutRowSchema.parse({ ...baseRow, structure: {} }),
    ).not.toThrow();
  });
});
