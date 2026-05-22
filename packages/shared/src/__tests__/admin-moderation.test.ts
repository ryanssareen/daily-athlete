import { describe, expect, it } from "vitest";

import { UserModerationRequestSchema } from "../admin-moderation";

describe("UserModerationRequestSchema", () => {
  it("accepts disable/delete when a reasonCode is present", () => {
    expect(
      UserModerationRequestSchema.parse({ action: "disable", reasonCode: "abuse" })
        .action
    ).toBe("disable");
    expect(
      UserModerationRequestSchema.parse({
        action: "delete",
        reasonCode: "tos_violation",
        reason: "context",
      }).reasonCode
    ).toBe("tos_violation");
  });

  it("requires a reasonCode for disable and delete", () => {
    expect(() => UserModerationRequestSchema.parse({ action: "disable" })).toThrow();
    expect(() => UserModerationRequestSchema.parse({ action: "delete" })).toThrow();
  });

  it("allows enable/restore without a reasonCode", () => {
    expect(UserModerationRequestSchema.parse({ action: "enable" }).action).toBe(
      "enable"
    );
    expect(UserModerationRequestSchema.parse({ action: "restore" }).action).toBe(
      "restore"
    );
  });

  it("rejects an unknown action", () => {
    expect(() => UserModerationRequestSchema.parse({ action: "ban" })).toThrow();
  });

  it("rejects an unknown reasonCode", () => {
    expect(() =>
      UserModerationRequestSchema.parse({ action: "disable", reasonCode: "nope" })
    ).toThrow();
  });

  it("caps the free-text reason length", () => {
    expect(() =>
      UserModerationRequestSchema.parse({
        action: "disable",
        reasonCode: "other",
        reason: "x".repeat(501),
      })
    ).toThrow();
  });
});
