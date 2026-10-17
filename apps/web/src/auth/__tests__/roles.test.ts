import { beforeEach, describe, expect, it, vi } from "vitest";

const events: string[] = [];
let releaseUsers: (() => void) | null = null;

function deferred<T>(value: T, label: string): Promise<T> {
  return new Promise((resolve) => {
    events.push(`start:${label}`);
    const finish = () => {
      events.push(`end:${label}`);
      resolve(value);
    };
    if (label === "users") releaseUsers = finish;
    else queueMicrotask(finish);
  });
}

vi.mock("@/auth/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "u1", email: "a@b.c" } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            deferred(
              { data: { role_flags: ["athlete"], timezone: "UTC" } },
              "users",
            ),
        }),
      }),
    }),
  }),
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            deferred(
              { data: { manual_fields: { onboarded_at: "2026-05-17T00:00:00Z" } } },
              "profile",
            ),
        }),
      }),
    }),
  }),
}));

import { getUserWithRoles } from "../roles";

describe("getUserWithRoles", () => {
  beforeEach(() => {
    events.length = 0;
    releaseUsers = null;
  });

  it("starts the onboarding-profile query without waiting for the users query", async () => {
    const pending = getUserWithRoles();
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toContain("start:users");
    expect(events).toContain("start:profile");

    releaseUsers?.();
    const session = await pending;
    expect(session?.onboarded).toBe(true);
  });

  it("reports onboarded=false when manual_fields has no onboarded_at", async () => {
    vi.resetModules();
    vi.doMock("@/db/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { manual_fields: {} } }),
            }),
          }),
        }),
      }),
    }));
    const { getUserWithRoles: fresh } = await import("../roles");
    const pending = fresh();
    await new Promise((r) => setTimeout(r, 0));
    releaseUsers?.();
    expect((await pending)?.onboarded).toBe(false);
  });
});
