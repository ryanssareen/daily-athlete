// Unit tests for the user-directory: search sanitizer + page clamp (pure) and
// the status-filter branch (chainable supabase mock, no DB).

import { beforeEach, describe, expect, it, vi } from "vitest";

const q = vi.hoisted(() => {
  const builder = {
    select: vi.fn((..._args: unknown[]) => builder),
    is: vi.fn((..._args: unknown[]) => builder),
    not: vi.fn((..._args: unknown[]) => builder),
    or: vi.fn((..._args: unknown[]) => builder),
    order: vi.fn((..._args: unknown[]) => builder),
    range: vi.fn((..._args: unknown[]) =>
      Promise.resolve({ data: [], count: 0, error: null })
    ),
  };
  return builder;
});

vi.mock("@/db/admin", () => ({ createAdminClient: () => ({ from: () => q }) }));

import { clampPageSize, listUsers, sanitizeSearch } from "@/db/admin-users";

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

describe("listUsers status filter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("active (default) filters deleted_at IS NULL", async () => {
    await listUsers({});
    expect(q.is).toHaveBeenCalledWith("deleted_at", null);
    expect(q.not).not.toHaveBeenCalled();
  });

  it("deleted lists soft-deleted rows (deleted_at IS NOT NULL)", async () => {
    await listUsers({ status: "deleted" });
    expect(q.not).toHaveBeenCalledWith("deleted_at", "is", null);
    expect(q.is).not.toHaveBeenCalled();
  });

  it("selects only minimal columns (adds moderation flags, no role_flags/tokens)", async () => {
    await listUsers({});
    const cols = q.select.mock.calls[0]?.[0] as string;
    expect(cols).toContain("disabled_at");
    expect(cols).toContain("deleted_at");
    expect(cols).not.toContain("role_flags");
    expect(cols).not.toContain("strava");
  });
});
