// Pure-unit tests for the user-directory search sanitizer + page clamp (no DB).

import { describe, expect, it } from "vitest";

import { clampPageSize, sanitizeSearch } from "@/db/admin-users";

describe("sanitizeSearch", () => {
  it("strips PostgREST filter metacharacters (comma, parens, star)", () => {
    expect(sanitizeSearch("a,b(c)*d")).toBe("abcd");
  });
  it("keeps email/name characters", () => {
    expect(sanitizeSearch("Jane.Doe@example-mail.com")).toBe(
      "Jane.Doe@example-mail.com"
    );
  });
  it("drops % and * wildcards but keeps _ (valid in emails)", () => {
    expect(sanitizeSearch("100%_*off")).toBe("100_off");
  });
  it("trims surrounding whitespace", () => {
    expect(sanitizeSearch("  hi  ")).toBe("hi");
  });
});

describe("clampPageSize", () => {
  it("clamps above the max to 100", () => expect(clampPageSize(9999)).toBe(100));
  it("floors at 1", () => expect(clampPageSize(0)).toBe(1));
  it("defaults to 25 on NaN", () => expect(clampPageSize(Number.NaN)).toBe(25));
  it("passes a normal value through", () => expect(clampPageSize(25)).toBe(25));
});
