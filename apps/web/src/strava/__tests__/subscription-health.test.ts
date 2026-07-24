// Unit tests for the split-brain subscription health probe
// (apps/web/src/strava/subscription-health.ts). config + global fetch are
// faked; the decision matrix (env id vs live subscription id) is the subject.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configState = vi.hoisted(() => ({
  value: {
    strava: {
      clientId: "cid" as string | undefined,
      clientSecret: "secret" as string | undefined,
      webhookSubscriptionId: undefined as number | undefined,
    },
  },
}));

vi.mock("@/config", () => ({ config: configState.value }));

import { checkStravaSubscriptionHealth } from "@/strava/subscription-health";

function stubFetch(impl: () => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl as never);
}

function subsResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  configState.value.strava = {
    clientId: "cid",
    clientSecret: "secret",
    webhookSubscriptionId: undefined,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkStravaSubscriptionHealth", () => {
  it("returns unconfigured and never calls Strava when creds are missing", async () => {
    configState.value.strava.clientSecret = undefined;
    const fetchSpy = stubFetch(async () => subsResponse([]));
    const health = await checkStravaSubscriptionHealth();
    expect(health.status).toBe("unconfigured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("healthy: env id matches the single live subscription", async () => {
    configState.value.strava.webhookSubscriptionId = 12345;
    stubFetch(async () => subsResponse([{ id: 12345 }]));
    const health = await checkStravaSubscriptionHealth();
    expect(health).toEqual({
      status: "healthy",
      configuredId: 12345,
      liveId: 12345,
      ok: true,
    });
  });

  it("id_mismatch: env id differs from the live subscription (stale env)", async () => {
    configState.value.strava.webhookSubscriptionId = 12345;
    stubFetch(async () => subsResponse([{ id: 999 }]));
    const health = await checkStravaSubscriptionHealth();
    expect(health).toMatchObject({ status: "id_mismatch", configuredId: 12345, liveId: 999 });
    expect(health.ok).toBe(false);
  });

  it("env_set_no_subscription: env set but Strava has no subscription", async () => {
    configState.value.strava.webhookSubscriptionId = 12345;
    stubFetch(async () => subsResponse([]));
    const health = await checkStravaSubscriptionHealth();
    expect(health).toMatchObject({ status: "env_set_no_subscription", liveId: null });
  });

  it("subscription_exists_env_unset: live subscription but env unset (the #97 shape)", async () => {
    configState.value.strava.webhookSubscriptionId = undefined;
    stubFetch(async () => subsResponse([{ id: 777 }]));
    const health = await checkStravaSubscriptionHealth();
    expect(health).toMatchObject({
      status: "subscription_exists_env_unset",
      configuredId: undefined,
      liveId: 777,
    });
  });

  it("no_subscription_env_unset: neither configured nor registered", async () => {
    stubFetch(async () => subsResponse([]));
    const health = await checkStravaSubscriptionHealth();
    expect(health.status).toBe("no_subscription_env_unset");
  });

  it("app_inactive: 403 from the subscriptions endpoint", async () => {
    configState.value.strava.webhookSubscriptionId = 12345;
    stubFetch(async () =>
      subsResponse({ errors: [{ resource: "Application", code: "Inactive" }] }, 403)
    );
    const health = await checkStravaSubscriptionHealth();
    expect(health.status).toBe("app_inactive");
  });

  it("probe_failed on a network error", async () => {
    stubFetch(async () => {
      throw new Error("ECONNRESET");
    });
    const health = await checkStravaSubscriptionHealth();
    expect(health.status).toBe("probe_failed");
  });

  it("probe_failed on an unexpected non-ok status", async () => {
    stubFetch(async () => subsResponse({}, 500));
    const health = await checkStravaSubscriptionHealth();
    expect(health.status).toBe("probe_failed");
  });
});
