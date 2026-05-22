import { describe, expect, it } from "vitest";

import {
  ModerationReasonCodeSchema,
  RoleFlagSchema,
  RoleFlagsSchema,
  UserRowSchema,
} from "../users";

describe("RoleFlagSchema", () => {
  it("accepts each documented flag", () => {
    expect(RoleFlagSchema.parse("athlete")).toBe("athlete");
    expect(RoleFlagSchema.parse("coach")).toBe("coach");
  });

  it("rejects unknown flags", () => {
    expect(() => RoleFlagSchema.parse("admin")).toThrow();
    expect(() => RoleFlagSchema.parse("")).toThrow();
  });
});

describe("RoleFlagsSchema", () => {
  it("accepts athlete-only and athlete+coach", () => {
    expect(RoleFlagsSchema.parse(["athlete"])).toEqual(["athlete"]);
    expect(RoleFlagsSchema.parse(["athlete", "coach"])).toEqual(["athlete", "coach"]);
  });

  it("rejects empty arrays (mirrors SQL cardinality >= 1)", () => {
    expect(() => RoleFlagsSchema.parse([])).toThrow();
  });

  it("rejects arrays containing an unknown flag", () => {
    expect(() => RoleFlagsSchema.parse(["athlete", "admin"])).toThrow();
  });
});

describe("UserRowSchema", () => {
  const baseRow = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    email: "user@example.com",
    display_name: "Test User",
    role_flags: ["athlete"],
    timezone: "America/Los_Angeles",
    created_at: "2026-05-13T10:30:00+00:00",
    updated_at: "2026-05-13T10:30:00+00:00",
    deleted_at: null,
    disabled_at: null,
    disabled_reason_code: null,
  };

  it("parses a fully-populated row", () => {
    const parsed = UserRowSchema.parse(baseRow);
    expect(parsed.id).toBe(baseRow.id);
    expect(parsed.role_flags).toEqual(["athlete"]);
  });

  it("allows email to be null (TEXT nullable)", () => {
    expect(() => UserRowSchema.parse({ ...baseRow, email: null })).not.toThrow();
  });

  it("allows display_name to be null", () => {
    expect(() => UserRowSchema.parse({ ...baseRow, display_name: null })).not.toThrow();
  });

  it("accepts Apple Hide-My-Email relay addresses", () => {
    const parsed = UserRowSchema.parse({
      ...baseRow,
      email: "abc123@privaterelay.appleid.com",
    });
    expect(parsed.email).toBe("abc123@privaterelay.appleid.com");
  });

  it("accepts soft-deleted rows", () => {
    const parsed = UserRowSchema.parse({
      ...baseRow,
      deleted_at: "2026-05-13T11:00:00+00:00",
    });
    expect(parsed.deleted_at).toBe("2026-05-13T11:00:00+00:00");
  });

  it("accepts a disabled row with a reason code", () => {
    const parsed = UserRowSchema.parse({
      ...baseRow,
      disabled_at: "2026-05-13T11:00:00+00:00",
      disabled_reason_code: "abuse",
    });
    expect(parsed.disabled_at).toBe("2026-05-13T11:00:00+00:00");
    expect(parsed.disabled_reason_code).toBe("abuse");
  });

  it("rejects an unknown disabled_reason_code", () => {
    expect(() =>
      UserRowSchema.parse({ ...baseRow, disabled_reason_code: "because" }),
    ).toThrow();
  });

  it("accepts PostgREST-style timestamps with offset", () => {
    expect(() =>
      UserRowSchema.parse({
        ...baseRow,
        created_at: "2026-05-13T10:30:00.123456+00:00",
      }),
    ).not.toThrow();
  });

  it("rejects an invalid UUID for id", () => {
    expect(() => UserRowSchema.parse({ ...baseRow, id: "not-a-uuid" })).toThrow();
  });

  it("rejects role_flags that does not satisfy SQL CHECK", () => {
    expect(() => UserRowSchema.parse({ ...baseRow, role_flags: [] })).toThrow();
    expect(() => UserRowSchema.parse({ ...baseRow, role_flags: ["admin"] })).toThrow();
  });
});

describe("ModerationReasonCodeSchema", () => {
  it("accepts each documented reason code", () => {
    for (const code of [
      "spam",
      "abuse",
      "tos_violation",
      "fraud",
      "user_request",
      "other",
    ]) {
      expect(ModerationReasonCodeSchema.parse(code)).toBe(code);
    }
  });

  it("rejects unknown / empty codes", () => {
    expect(() => ModerationReasonCodeSchema.parse("banned")).toThrow();
    expect(() => ModerationReasonCodeSchema.parse("")).toThrow();
  });
});
