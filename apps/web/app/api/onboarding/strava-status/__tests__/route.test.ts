// Unit tests for GET /api/onboarding/strava-status.
//
// Covers the Bearer path (Flutter app, no cookies) in addition to the cookie
// path: the mobile Settings screen relies on `connected` to avoid showing
// "Connect Strava" to athletes who already have a token.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  lastBearerToken: undefined as string | undefined,
  hasToken: false,
}));

vi.mock("@/auth/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async (token?: string) => {
        mocks.lastBearerToken = token;
        return { data: { user: mocks.authUser }, error: null };
      },
    },
  }),
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { backfill_status: { state: "complete" } },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/db/strava-tokens", () => ({
  hasStravaToken: async () => mocks.hasToken,
}));

import { GET } from "../route";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/onboarding/strava-status", {
    headers,
  });
}

describe("GET /api/onboarding/strava-status", () => {
  beforeEach(() => {
    mocks.authUser = null;
    mocks.lastBearerToken = undefined;
    mocks.hasToken = false;
  });

  it("401s when unauthenticated", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("resolves a Bearer-only caller and reports connected", async () => {
    mocks.authUser = { id: "user-1" };
    mocks.hasToken = true;

    const res = await GET(req({ Authorization: "Bearer jwt-abc" }));

    expect(res.status).toBe(200);
    expect(mocks.lastBearerToken).toBe("jwt-abc");
    expect(await res.json()).toEqual({
      connected: true,
      backfill_status: { state: "complete" },
    });
  });

  it("reports not connected when there is no token row", async () => {
    mocks.authUser = { id: "user-1" };

    const res = await GET(req({ Authorization: "Bearer jwt-abc" }));

    expect((await res.json()).connected).toBe(false);
  });
});
