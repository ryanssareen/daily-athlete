import { describe, expect, it } from "vitest";

import {
  EntitlementRowSchema,
  EntitlementSourceSchema,
} from "../entitlement";

describe("EntitlementSourceSchema", () => {
  it("accepts the documented v1 source", () => {
    expect(EntitlementSourceSchema.parse("revenuecat")).toBe("revenuecat");
  });

  it("rejects other sources", () => {
    expect(() => EntitlementSourceSchema.parse("stripe")).toThrow();
    expect(() => EntitlementSourceSchema.parse("apple_iap")).toThrow();
  });
});

describe("EntitlementRowSchema", () => {
  const baseRow = {
    user_id: "550e8400-e29b-41d4-a716-446655440000",
    entitlement_key: "pro_annual",
    active: true,
    source: "revenuecat",
    expires_at: "2027-05-13T00:00:00+00:00",
    updated_at: "2026-05-13T10:30:00+00:00",
  };

  it("parses a fully-populated row", () => {
    const parsed = EntitlementRowSchema.parse(baseRow);
    expect(parsed.active).toBe(true);
    expect(parsed.source).toBe("revenuecat");
  });

  it("allows expires_at to be null (lifetime entitlement)", () => {
    const parsed = EntitlementRowSchema.parse({ ...baseRow, expires_at: null });
    expect(parsed.expires_at).toBeNull();
  });

  it("accepts inactive entitlements", () => {
    const parsed = EntitlementRowSchema.parse({ ...baseRow, active: false });
    expect(parsed.active).toBe(false);
  });

  it("accepts arbitrary entitlement_key strings (open-ended v1)", () => {
    expect(() =>
      EntitlementRowSchema.parse({ ...baseRow, entitlement_key: "any_key" }),
    ).not.toThrow();
    expect(() =>
      EntitlementRowSchema.parse({ ...baseRow, entitlement_key: "" }),
    ).not.toThrow();
  });

  it("rejects rows with an unknown source", () => {
    expect(() =>
      EntitlementRowSchema.parse({ ...baseRow, source: "stripe" }),
    ).toThrow();
  });

  it("rejects rows with a non-boolean active field", () => {
    expect(() =>
      EntitlementRowSchema.parse({ ...baseRow, active: "yes" }),
    ).toThrow();
    expect(() =>
      EntitlementRowSchema.parse({ ...baseRow, active: 1 }),
    ).toThrow();
  });

  it("rejects rows with an invalid user_id", () => {
    expect(() =>
      EntitlementRowSchema.parse({ ...baseRow, user_id: "not-a-uuid" }),
    ).toThrow();
  });
});
