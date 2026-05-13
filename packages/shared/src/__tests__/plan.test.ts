import { describe, expect, it } from "vitest";

import { PlanRowSchema, PlanSourceSchema, PlanStatusSchema } from "../plan";

describe("PlanStatusSchema", () => {
  it("accepts each documented status", () => {
    expect(PlanStatusSchema.parse("active")).toBe("active");
    expect(PlanStatusSchema.parse("archived")).toBe("archived");
  });

  it("rejects other status values", () => {
    expect(() => PlanStatusSchema.parse("paused")).toThrow();
    expect(() => PlanStatusSchema.parse("")).toThrow();
  });
});

describe("PlanSourceSchema", () => {
  it("accepts each documented source", () => {
    expect(PlanSourceSchema.parse("ai_generated")).toBe("ai_generated");
    expect(PlanSourceSchema.parse("coach_assigned")).toBe("coach_assigned");
    expect(PlanSourceSchema.parse("imported")).toBe("imported");
  });

  it("rejects other source values", () => {
    expect(() => PlanSourceSchema.parse("stripe")).toThrow();
    expect(() => PlanSourceSchema.parse("manual")).toThrow();
  });
});

describe("PlanRowSchema", () => {
  const baseRow = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    athlete_id: "660e8400-e29b-41d4-a716-446655440001",
    status: "active",
    event_type: "marathon",
    event_date: "2026-10-15",
    source: "ai_generated",
    created_from_review_id: null,
    created_at: "2026-05-13T10:30:00+00:00",
    archived_at: null,
    deleted_at: null,
  };

  it("parses a fully-populated active plan", () => {
    const parsed = PlanRowSchema.parse(baseRow);
    expect(parsed.status).toBe("active");
    expect(parsed.source).toBe("ai_generated");
  });

  it("accepts an archived plan with archived_at set", () => {
    const parsed = PlanRowSchema.parse({
      ...baseRow,
      status: "archived",
      archived_at: "2026-06-01T00:00:00+00:00",
    });
    expect(parsed.status).toBe("archived");
    expect(parsed.archived_at).toBe("2026-06-01T00:00:00+00:00");
  });

  it("accepts a soft-deleted plan", () => {
    const parsed = PlanRowSchema.parse({
      ...baseRow,
      deleted_at: "2026-06-15T00:00:00+00:00",
    });
    expect(parsed.deleted_at).toBe("2026-06-15T00:00:00+00:00");
  });

  it("accepts null event_type / event_date (generic non-event plan)", () => {
    expect(() =>
      PlanRowSchema.parse({ ...baseRow, event_type: null, event_date: null }),
    ).not.toThrow();
  });

  it("accepts null created_from_review_id (plan not from a review)", () => {
    expect(() =>
      PlanRowSchema.parse({ ...baseRow, created_from_review_id: null }),
    ).not.toThrow();
  });

  it("accepts a UUID created_from_review_id (plan from an accepted review)", () => {
    const parsed = PlanRowSchema.parse({
      ...baseRow,
      created_from_review_id: "770e8400-e29b-41d4-a716-446655440002",
    });
    expect(parsed.created_from_review_id).toBe(
      "770e8400-e29b-41d4-a716-446655440002",
    );
  });

  it("rejects rows with unknown status", () => {
    expect(() => PlanRowSchema.parse({ ...baseRow, status: "paused" })).toThrow();
  });

  it("rejects rows with unknown source", () => {
    expect(() => PlanRowSchema.parse({ ...baseRow, source: "stripe" })).toThrow();
  });

  it("rejects malformed UUIDs", () => {
    expect(() => PlanRowSchema.parse({ ...baseRow, id: "not-a-uuid" })).toThrow();
    expect(() =>
      PlanRowSchema.parse({ ...baseRow, athlete_id: "not-a-uuid" }),
    ).toThrow();
    expect(() =>
      PlanRowSchema.parse({
        ...baseRow,
        created_from_review_id: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("accepts timestamps with offset notation", () => {
    expect(() =>
      PlanRowSchema.parse({
        ...baseRow,
        created_at: "2026-05-13T10:30:00.123456+00:00",
      }),
    ).not.toThrow();
  });

  it("accepts event_date as ISO date string (no time component)", () => {
    expect(() =>
      PlanRowSchema.parse({ ...baseRow, event_date: "2026-10-15" }),
    ).not.toThrow();
  });

  it("rejects rows missing required fields", () => {
    const { status, ...withoutStatus } = baseRow;
    expect(() => PlanRowSchema.parse(withoutStatus)).toThrow();
    const { source, ...withoutSource } = baseRow;
    expect(() => PlanRowSchema.parse(withoutSource)).toThrow();
    const { created_at, ...withoutCreatedAt } = baseRow;
    expect(() => PlanRowSchema.parse(withoutCreatedAt)).toThrow();
  });
});
