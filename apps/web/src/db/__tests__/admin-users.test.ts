// DB-backed tests for the user directory. Requires a local Supabase stack
// (see setup.ts). Created users are auto-cleaned by the setup afterEach.

import { beforeAll, describe, expect, it } from "vitest";

import { createTestUser, serviceClient } from "@/db/__tests__/setup";
import { listUsers } from "@/db/admin-users";

let sc: ReturnType<typeof serviceClient>;
beforeAll(() => {
  sc = serviceClient();
});

describe("listUsers (DB)", () => {
  it("returns name + email and finds a user by email search", async () => {
    const u = await createTestUser();
    await sc.from("users").update({ display_name: "Test Person" }).eq("id", u.id);

    const res = await listUsers({ search: u.email });
    const found = res.users.find((r) => r.id === u.id);
    expect(found?.email).toBe(u.email);
    expect(found?.display_name).toBe("Test Person");
  });

  it("excludes soft-deleted users from both rows and the count", async () => {
    const u = await createTestUser();
    const marker = `zz-${crypto.randomUUID()}`;
    await sc.from("users").update({ display_name: marker }).eq("id", u.id);
    await sc
      .from("users")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", u.id);

    const res = await listUsers({ search: marker });
    expect(res.users.some((r) => r.id === u.id)).toBe(false);
    expect(res.total).toBe(0);
  });

  it("paginates with a stable order (no overlap or skip)", async () => {
    const marker = `pg-${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i++) {
      const u = await createTestUser();
      await sc
        .from("users")
        .update({ display_name: `${marker}-${i}` })
        .eq("id", u.id);
    }

    const p0 = await listUsers({ search: marker, page: 0, pageSize: 2 });
    const p1 = await listUsers({ search: marker, page: 1, pageSize: 2 });
    expect(p0.total).toBe(3);
    expect(p0.users).toHaveLength(2);
    expect(p1.users).toHaveLength(1);
    const ids = new Set([...p0.users, ...p1.users].map((r) => r.id));
    expect(ids.size).toBe(3); // no overlap across pages
  });

  it("clamps an oversized page size to the maximum", async () => {
    const res = await listUsers({ pageSize: 9999 });
    expect(res.pageSize).toBe(100);
  });
});
