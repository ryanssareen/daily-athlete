import { describe, expect, it } from "vitest";

import {
  EncryptedBytesSchema,
  StravaTokenRowSchema,
} from "../strava-token";

describe("EncryptedBytesSchema", () => {
  it("accepts a base64 string (PostgREST default)", () => {
    expect(EncryptedBytesSchema.parse("c29tZS1iYXNlNjQ=")).toBe(
      "c29tZS1iYXNlNjQ=",
    );
  });

  it("accepts a Uint8Array", () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(EncryptedBytesSchema.parse(bytes)).toBe(bytes);
  });

  it("accepts a Node Buffer (Buffer extends Uint8Array)", () => {
    const buf = Buffer.from("hello", "utf8");
    expect(EncryptedBytesSchema.parse(buf)).toBe(buf);
  });

  it("rejects null and undefined", () => {
    expect(() => EncryptedBytesSchema.parse(null)).toThrow();
    expect(() => EncryptedBytesSchema.parse(undefined)).toThrow();
  });

  it("rejects numbers and objects", () => {
    expect(() => EncryptedBytesSchema.parse(42)).toThrow();
    expect(() => EncryptedBytesSchema.parse({ foo: "bar" })).toThrow();
  });
});

describe("StravaTokenRowSchema", () => {
  const baseRow = {
    user_id: "550e8400-e29b-41d4-a716-446655440000",
    access_token_enc: "c29tZS1lbmNyeXB0ZWQ=",
    refresh_token_enc: "YW5vdGhlci1lbmNyeXB0ZWQ=",
    expires_at: "2026-05-14T10:30:00+00:00",
    scope: "read,activity:read_all",
    athlete_strava_id: 1234567890,
    key_version: 1,
    created_at: "2026-05-13T10:30:00+00:00",
    last_used_at: "2026-05-13T11:00:00+00:00",
  };

  it("parses a fully-populated row", () => {
    const parsed = StravaTokenRowSchema.parse(baseRow);
    expect(parsed.user_id).toBe(baseRow.user_id);
    expect(parsed.athlete_strava_id).toBe(1234567890);
    expect(parsed.key_version).toBe(1);
  });

  it("allows last_used_at to be null (never used)", () => {
    const parsed = StravaTokenRowSchema.parse({
      ...baseRow,
      last_used_at: null,
    });
    expect(parsed.last_used_at).toBeNull();
  });

  it("accepts Uint8Array token columns alongside base64 strings", () => {
    const parsed = StravaTokenRowSchema.parse({
      ...baseRow,
      access_token_enc: new Uint8Array([1, 2, 3, 4]),
    });
    expect(parsed.access_token_enc).toBeInstanceOf(Uint8Array);
  });

  it("accepts key_version values from 1 upward", () => {
    expect(() =>
      StravaTokenRowSchema.parse({ ...baseRow, key_version: 1 }),
    ).not.toThrow();
    expect(() =>
      StravaTokenRowSchema.parse({ ...baseRow, key_version: 5 }),
    ).not.toThrow();
  });

  it("rejects negative key_version (SMALLINT nonnegative)", () => {
    expect(() =>
      StravaTokenRowSchema.parse({ ...baseRow, key_version: -1 }),
    ).toThrow();
  });

  it("rejects non-integer athlete_strava_id", () => {
    expect(() =>
      StravaTokenRowSchema.parse({ ...baseRow, athlete_strava_id: 1.5 }),
    ).toThrow();
  });

  it("rejects rows with invalid user_id", () => {
    expect(() =>
      StravaTokenRowSchema.parse({ ...baseRow, user_id: "not-a-uuid" }),
    ).toThrow();
  });

  it("rejects rows missing required fields", () => {
    const { scope, ...withoutScope } = baseRow;
    expect(() => StravaTokenRowSchema.parse(withoutScope)).toThrow();
  });
});
