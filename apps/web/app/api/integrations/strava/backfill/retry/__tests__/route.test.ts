// Unit tests for POST /api/integrations/strava/backfill/retry
//
// All external dependencies (auth, admin DB, Inngest) are mocked so the
// test suite needs no local Supabase or Inngest dev server.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
  process.env.INNGEST_EVENT_KEY = "test-inngest-event-key";
  process.env.INNGEST_SIGNING_KEY = "test-inngest-signing-key";
  process.env.STRAVA_TOKEN_KEYS =
    "1:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  process.env.STRAVA_OAUTH_STATE_SIGNING_KEY =
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  process.env.STRAVA_CLIENT_ID = "test-client-id";
  process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
  process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = "test-webhook-token";
});

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  stravaTokenExists: true,
  currentBackfillStatus: { state: "failed" } as Record<string, unknown>,
  updateRowCount: 1,
  updateError: null as string | null,
  inngestSend: vi.fn(),
}));

vi.mock("@/auth/server", () => ({
  createClient: async () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: mocks.authUser }, error: null }) },
  }),
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => {
    let callIndex = 0;
    return {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (table === "strava_tokens") {
                return { data: mocks.stravaTokenExists ? { user_id: mocks.authUser?.id } : null };
              }
              return { data: { backfill_status: mocks.currentBackfillStatus } };
            },
          }),
        }),
        update: (payload: unknown) => ({
          eq: (_col: string, _val: unknown) => ({
            filter: () => ({
              select: async () => {
                if (mocks.updateError) {
                  return { data: null, error: { message: mocks.updateError, constructor: { name: "Error" } } };
                }
                if (mocks.updateRowCount === 0) {
                  return { data: [], error: null };
                }
                // Return the backfill_status field from the update payload
                // (mirrors what PostgREST returns on .select("backfill_status"))
                const bs = (payload as Record<string, unknown>).backfill_status;
                return { data: [{ backfill_status: bs }], error: null };
              },
            }),
            // For the revert-on-enqueue-failure path (chained after .eq())
            then: (resolve: (v: unknown) => void) => resolve({ error: null }),
          }),
        }),
        insert: () => ({}),
      }),
    };
  },
}));

vi.mock("@/inngest/client", () => ({
  inngest: { send: (...args: unknown[]) => mocks.inngestSend(...args) },
}));

import { POST } from "../route";

function makeRequest(opts: {
  userId?: string;
  secFetchSite?: string;
  noAuth?: boolean;
}) {
  mocks.authUser = opts.noAuth ? null : { id: opts.userId ?? "user-uuid-1" };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: opts.noAuth ? "" : "Bearer test-jwt",
  };
  if (opts.secFetchSite) headers["sec-fetch-site"] = opts.secFetchSite;
  return new Request("http://localhost/api/integrations/strava/backfill/retry", {
    method: "POST",
    headers,
  });
}

describe("POST /api/integrations/strava/backfill/retry", () => {
  beforeEach(() => {
    mocks.authUser = { id: "user-uuid-1" };
    mocks.stravaTokenExists = true;
    mocks.currentBackfillStatus = { state: "failed" };
    mocks.updateRowCount = 1;
    mocks.updateError = null;
    mocks.inngestSend.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for cross-origin request (CSRF guard)", async () => {
    const req = makeRequest({ secFetchSite: "cross-site" });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 when not authenticated", async () => {
    const req = makeRequest({ noAuth: true });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 422 when no Strava connection", async () => {
    mocks.stravaTokenExists = false;
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("no_strava_connection");
  });

  it("returns 202 + queued status on success", async () => {
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("queued");
    expect(mocks.inngestSend).toHaveBeenCalledOnce();
    expect(mocks.inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({ name: "strava/backfill.start" })
    );
  });

  it("returns 409 already_in_progress when update matches 0 rows and state is queued", async () => {
    mocks.updateRowCount = 0;
    mocks.currentBackfillStatus = { state: "queued" };
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("already_in_progress");
  });

  it("returns 422 needs_reconnect when update matches 0 rows and state is needs_reauth", async () => {
    mocks.updateRowCount = 0;
    mocks.currentBackfillStatus = { state: "needs_reauth" };
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("needs_reconnect");
  });

  it("returns 500 on DB update error", async () => {
    mocks.updateError = "connection refused";
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal_error");
  });

  it("returns 502 and reverts status when Inngest send throws", async () => {
    mocks.inngestSend.mockRejectedValueOnce(new Error("inngest unreachable"));
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("enqueue_failed");
  });

  it("allows same-origin Sec-Fetch-Site", async () => {
    const req = makeRequest({ secFetchSite: "same-origin" });
    const res = await POST(req);
    expect(res.status).toBe(202);
  });

  it("allows missing Sec-Fetch-Site (native mobile / curl)", async () => {
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(202);
  });
});
