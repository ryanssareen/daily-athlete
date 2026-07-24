// Tests for GET /api/cron/strava-reconcile. The reconcile sweep and the health
// probe are faked; this asserts the route's contract: CRON_SECRET gating, the
// summary payload, split-brain warn-logging, and fail-soft on a sweep error.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reconcileAllStravaUsers, checkStravaSubscriptionHealth } = vi.hoisted(
  () => ({
    reconcileAllStravaUsers: vi.fn(),
    checkStravaSubscriptionHealth: vi.fn(),
  })
);

vi.mock("@/db/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/strava/reconcile", () => ({ reconcileAllStravaUsers }));
vi.mock("@/strava/subscription-health", () => ({ checkStravaSubscriptionHealth }));

async function invoke(authHeader?: string) {
  const { GET } = await import("../route");
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return GET(new Request("http://localhost/api/cron/strava-reconcile", { headers }));
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  vi.resetModules();
  reconcileAllStravaUsers.mockReset();
  checkStravaSubscriptionHealth.mockReset();
  checkStravaSubscriptionHealth.mockResolvedValue({
    status: "healthy",
    configuredId: 12345,
    liveId: 12345,
    ok: true,
  });
  reconcileAllStravaUsers.mockResolvedValue({
    processed: 3,
    recovered: 5,
    failed: 0,
    skipped: 0,
    results: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/cron/strava-reconcile", () => {
  it("returns 401 without the CRON_SECRET", async () => {
    const res = await invoke();
    expect(res.status).toBe(401);
    expect(reconcileAllStravaUsers).not.toHaveBeenCalled();
  });

  it("returns 401 with a wrong secret", async () => {
    const res = await invoke("Bearer nope");
    expect(res.status).toBe(401);
  });

  it("runs the sweep and returns the summary", async () => {
    const res = await invoke("Bearer test-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      health: "healthy",
      processed: 3,
      recovered: 5,
      failed: 0,
      skipped: 0,
    });
  });

  it("warn-logs when the subscription is unhealthy (split-brain surfaced)", async () => {
    checkStravaSubscriptionHealth.mockResolvedValue({
      status: "subscription_exists_env_unset",
      configuredId: undefined,
      liveId: 777,
      ok: false,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await invoke("Bearer test-secret");
    expect(res.status).toBe(200);
    const call = warnSpy.mock.calls.find(
      (args) => args[0] === "[strava.reconcile] subscription_unhealthy"
    );
    expect(call).toBeDefined();
    expect(JSON.parse(call![1] as string)).toMatchObject({
      status: "subscription_exists_env_unset",
      configured_id: null,
      live_id: 777,
    });
    warnSpy.mockRestore();
  });

  it("returns 500 if the sweep throws (never a silent success)", async () => {
    reconcileAllStravaUsers.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await invoke("Bearer test-secret");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "sweep_failed" });
  });
});
