import { describe, expect, it } from "vitest";

import {
  WorkoutMatchMethodSchema,
  WorkoutMatchRowSchema,
} from "../workout-match";

describe("WorkoutMatchMethodSchema", () => {
  it("accepts each documented method", () => {
    expect(WorkoutMatchMethodSchema.parse("auto_same_day_sport")).toBe(
      "auto_same_day_sport",
    );
    expect(WorkoutMatchMethodSchema.parse("manual_user_link")).toBe(
      "manual_user_link",
    );
    expect(WorkoutMatchMethodSchema.parse("merged_from_manual")).toBe(
      "merged_from_manual",
    );
  });

  it("rejects unknown methods", () => {
    expect(() => WorkoutMatchMethodSchema.parse("auto_geofence")).toThrow();
    expect(() => WorkoutMatchMethodSchema.parse("")).toThrow();
  });
});

describe("WorkoutMatchRowSchema", () => {
  const baseRow = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    planned_workout_id: "660e8400-e29b-41d4-a716-446655440001",
    completed_workout_id: "770e8400-e29b-41d4-a716-446655440002",
    confidence: 0.92,
    method: "auto_same_day_sport",
    matched_at: "2026-05-13T06:35:30+00:00",
    deleted_at: null,
  };

  it("parses a fully-populated auto-match row", () => {
    const parsed = WorkoutMatchRowSchema.parse(baseRow);
    expect(parsed.method).toBe("auto_same_day_sport");
    expect(parsed.confidence).toBe(0.92);
  });

  it("accepts a manual link with confidence = 1.0", () => {
    const parsed = WorkoutMatchRowSchema.parse({
      ...baseRow,
      method: "manual_user_link",
      confidence: 1.0,
    });
    expect(parsed.method).toBe("manual_user_link");
    expect(parsed.confidence).toBe(1.0);
  });

  it("accepts a merged-from-manual match (R21 trail)", () => {
    const parsed = WorkoutMatchRowSchema.parse({
      ...baseRow,
      method: "merged_from_manual",
    });
    expect(parsed.method).toBe("merged_from_manual");
  });

  it("accepts a soft-deleted match (re-link bookkeeping)", () => {
    const parsed = WorkoutMatchRowSchema.parse({
      ...baseRow,
      deleted_at: "2026-05-14T08:00:00+00:00",
    });
    expect(parsed.deleted_at).toBe("2026-05-14T08:00:00+00:00");
  });

  it("accepts confidence at boundaries", () => {
    expect(() =>
      WorkoutMatchRowSchema.parse({ ...baseRow, confidence: 0 }),
    ).not.toThrow();
    expect(() =>
      WorkoutMatchRowSchema.parse({ ...baseRow, confidence: 1 }),
    ).not.toThrow();
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(() =>
      WorkoutMatchRowSchema.parse({ ...baseRow, confidence: -0.01 }),
    ).toThrow();
    expect(() =>
      WorkoutMatchRowSchema.parse({ ...baseRow, confidence: 1.01 }),
    ).toThrow();
    expect(() =>
      WorkoutMatchRowSchema.parse({ ...baseRow, confidence: 2 }),
    ).toThrow();
  });

  it("rejects non-numeric confidence", () => {
    expect(() =>
      WorkoutMatchRowSchema.parse({ ...baseRow, confidence: "0.5" }),
    ).toThrow();
  });

  it("rejects unknown method", () => {
    expect(() =>
      WorkoutMatchRowSchema.parse({ ...baseRow, method: "auto_geofence" }),
    ).toThrow();
  });

  it("rejects malformed UUIDs", () => {
    expect(() =>
      WorkoutMatchRowSchema.parse({ ...baseRow, id: "not-a-uuid" }),
    ).toThrow();
    expect(() =>
      WorkoutMatchRowSchema.parse({
        ...baseRow,
        planned_workout_id: "not-a-uuid",
      }),
    ).toThrow();
    expect(() =>
      WorkoutMatchRowSchema.parse({
        ...baseRow,
        completed_workout_id: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("accepts timestamps with offset notation", () => {
    expect(() =>
      WorkoutMatchRowSchema.parse({
        ...baseRow,
        matched_at: "2026-05-13T06:35:30.123456+00:00",
      }),
    ).not.toThrow();
  });

  it("rejects rows missing required fields", () => {
    const { planned_workout_id, ...withoutPlannedId } = baseRow;
    expect(() => WorkoutMatchRowSchema.parse(withoutPlannedId)).toThrow();
    const { completed_workout_id, ...withoutCompletedId } = baseRow;
    expect(() => WorkoutMatchRowSchema.parse(withoutCompletedId)).toThrow();
    const { confidence, ...withoutConfidence } = baseRow;
    expect(() => WorkoutMatchRowSchema.parse(withoutConfidence)).toThrow();
    const { method, ...withoutMethod } = baseRow;
    expect(() => WorkoutMatchRowSchema.parse(withoutMethod)).toThrow();
    const { matched_at, ...withoutMatchedAt } = baseRow;
    expect(() => WorkoutMatchRowSchema.parse(withoutMatchedAt)).toThrow();
  });

  it("does NOT enforce cross-side athlete consistency (SQL/RLS concern, not Zod)", () => {
    // workout_matches.planned_workout_id and .completed_workout_id should
    // belong to the same athlete, but the Zod row contract does not
    // duplicate this invariant. RLS WITH CHECK (both INSERT and UPDATE)
    // enforces it for authenticated callers; service-role paths must
    // validate athlete identity explicitly. This test pins the Zod
    // behavior so future contributors understand which layer enforces
    // which guarantee.
    const parsed = WorkoutMatchRowSchema.parse(baseRow);
    expect(parsed.planned_workout_id).toBeDefined();
    expect(parsed.completed_workout_id).toBeDefined();
  });
});
