import { describe, expect, it } from "vitest";

import {
  StravaRawKindSchema,
  StravaRawPayloadRowSchema,
} from "../strava-raw-payload";

describe("StravaRawKindSchema", () => {
  it("accepts the two documented kinds", () => {
    expect(StravaRawKindSchema.parse("webhook")).toBe("webhook");
    expect(StravaRawKindSchema.parse("hydration")).toBe("hydration");
  });

  it("rejects other kinds", () => {
    expect(() => StravaRawKindSchema.parse("polling")).toThrow();
    expect(() => StravaRawKindSchema.parse("")).toThrow();
  });
});

describe("StravaRawPayloadRowSchema", () => {
  const baseRow = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    user_id: "660e8400-e29b-41d4-a716-446655440001",
    kind: "hydration",
    payload: { activity_id: 12345, type: "Run" },
    arrived_at: "2026-05-13T10:30:00+00:00",
  };

  it("parses a fully-populated hydration row", () => {
    const parsed = StravaRawPayloadRowSchema.parse(baseRow);
    expect(parsed.kind).toBe("hydration");
    expect(parsed.payload).toEqual({ activity_id: 12345, type: "Run" });
  });

  it("allows user_id to be null for webhook deliveries (resolver pending)", () => {
    const parsed = StravaRawPayloadRowSchema.parse({
      ...baseRow,
      kind: "webhook",
      user_id: null,
    });
    expect(parsed.user_id).toBeNull();
  });

  it("accepts arbitrary payload shapes (z.unknown is intentional)", () => {
    expect(() =>
      StravaRawPayloadRowSchema.parse({ ...baseRow, payload: [1, 2, 3] }),
    ).not.toThrow();
    expect(() =>
      StravaRawPayloadRowSchema.parse({
        ...baseRow,
        payload: { nested: { deeply: { foo: "bar" } } },
      }),
    ).not.toThrow();
    expect(() =>
      StravaRawPayloadRowSchema.parse({ ...baseRow, payload: null }),
    ).not.toThrow();
  });

  it("rejects rows with unknown kind", () => {
    expect(() =>
      StravaRawPayloadRowSchema.parse({ ...baseRow, kind: "polling" }),
    ).toThrow();
  });

  it("rejects rows with non-UUID id", () => {
    expect(() =>
      StravaRawPayloadRowSchema.parse({ ...baseRow, id: "not-a-uuid" }),
    ).toThrow();
  });

  it("rejects rows missing required fields", () => {
    const { arrived_at, ...withoutArrivedAt } = baseRow;
    expect(() => StravaRawPayloadRowSchema.parse(withoutArrivedAt)).toThrow();
  });

  it("does NOT enforce the kind=hydration -> user_id NOT NULL constraint", () => {
    // The SQL CHECK enforces this; the Zod row contract represents what
    // PostgREST returns and does not duplicate the insert precondition.
    // A row with kind=hydration and user_id=null could not exist in SQL
    // but would parse here -- the row contract is permissive on this axis
    // by design.
    expect(() =>
      StravaRawPayloadRowSchema.parse({
        ...baseRow,
        kind: "hydration",
        user_id: null,
      }),
    ).not.toThrow();
  });
});
