// Unit tests for POST|DELETE /api/athlete/coach/disconnect
//
// Dependencies mocked:
// - @/auth/server (the JWT client resolveAuth reads getUser from)
// - @/db/admin   (service-role client constructor — unused once roster is mocked)
// - @/db/roster  (archiveAthleteCoachLink — the DB work is covered by the
//                 RLS integration suite; here we assert the HTTP/auth wiring)
//
// Scenarios:
// - no auth → 401, archive never called
// - active link archived → 204, called with the CALLER's own id (scoping)
// - no active coach → 204 (idempotent)
// - archive throws → 500
// - DELETE behaves identically to POST

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  archiveResult: null as { linkId: string; coachId: string } | null,
  archiveThrows: false,
  archiveCalls: [] as string[],
}));

vi.mock("@/auth/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: (_token?: string) =>
        Promise.resolve({ data: { user: mocks.authUser }, error: null }),
    },
  }),
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({}),
}));

vi.mock("@/db/roster", () => ({
  archiveAthleteCoachLink: (_admin: unknown, athleteId: string) => {
    mocks.archiveCalls.push(athleteId);
    if (mocks.archiveThrows) throw new Error("boom");
    return Promise.resolve(mocks.archiveResult);
  },
}));

async function invoke(method: "POST" | "DELETE" = "POST"): Promise<Response> {
  const mod = await import("../route");
  const handler = method === "POST" ? mod.POST : mod.DELETE;
  return handler(
    new Request("http://localhost:3000/api/athlete/coach/disconnect", { method }),
  );
}

describe("POST|DELETE /api/athlete/coach/disconnect", () => {
  beforeEach(() => {
    mocks.authUser = null;
    mocks.archiveResult = null;
    mocks.archiveThrows = false;
    mocks.archiveCalls = [];
  });

  it("returns 401 when unauthenticated and never touches the DB", async () => {
    const res = await invoke();
    expect(res.status).toBe(401);
    expect(mocks.archiveCalls).toHaveLength(0);
  });

  it("returns 204 and archives the caller's own link", async () => {
    mocks.authUser = { id: "athlete-1" };
    mocks.archiveResult = { linkId: "link-1", coachId: "coach-1" };

    const res = await invoke();
    expect(res.status).toBe(204);
    // Scoped to the authenticated caller — never an id from the request body.
    expect(mocks.archiveCalls).toEqual(["athlete-1"]);
  });

  it("returns 204 (idempotent) when the athlete has no active coach", async () => {
    mocks.authUser = { id: "athlete-2" };
    mocks.archiveResult = null;

    const res = await invoke();
    expect(res.status).toBe(204);
    expect(mocks.archiveCalls).toEqual(["athlete-2"]);
  });

  it("returns 500 when the archive fails", async () => {
    mocks.authUser = { id: "athlete-3" };
    mocks.archiveThrows = true;

    const res = await invoke();
    expect(res.status).toBe(500);
  });

  it("DELETE behaves identically to POST", async () => {
    mocks.authUser = { id: "athlete-4" };
    mocks.archiveResult = { linkId: "l", coachId: "c" };

    const res = await invoke("DELETE");
    expect(res.status).toBe(204);
    expect(mocks.archiveCalls).toEqual(["athlete-4"]);
  });
});
