// Unit tests for defaultPlanApi (plan Unit 6).
//
// The web vitest env is Node-only (no jsdom/testing-library), so -- exactly
// like defaultProposalApi's tests in (athlete)/plan/__tests__/page.test.tsx --
// we cover the fetch-shaped API client with a stubbed global fetch rather
// than rendering <PlanActions>/<PlanHistoryList>. The two-step confirm
// interaction and per-status button visibility are visual/behavioral and
// have no pure-logic seam to unit test without a renderer.

import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultPlanApi } from "@/plan/PlanActions";

function mockFetch(status: number, body: unknown = {}): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("defaultPlanApi.archive", () => {
  it("PATCHes /api/plans/:id/archive", async () => {
    const fetchSpy = mockFetch(200, { plan: { id: "p1", status: "archived" } });
    vi.stubGlobal("fetch", fetchSpy);

    await defaultPlanApi.archive("p1");

    const call = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/plans/p1/archive");
    expect(call[1].method).toBe("PATCH");
  });

  it("throws on a non-OK response (drives the retryable error state)", async () => {
    vi.stubGlobal("fetch", mockFetch(404, { error: "not_found" }));
    await expect(defaultPlanApi.archive("p1")).rejects.toThrow();
  });
});

describe("defaultPlanApi.softDelete", () => {
  it("DELETEs /api/plans/:id", async () => {
    const fetchSpy = mockFetch(204);
    vi.stubGlobal("fetch", fetchSpy);

    await defaultPlanApi.softDelete("p1");

    const call = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/plans/p1");
    expect(call[1].method).toBe("DELETE");
  });

  it("treats 204 as success even though res.ok may vary by fetch polyfill", async () => {
    vi.stubGlobal("fetch", mockFetch(204));
    await expect(defaultPlanApi.softDelete("p1")).resolves.toBeUndefined();
  });

  it("throws on a non-OK, non-204 response", async () => {
    vi.stubGlobal("fetch", mockFetch(404, { error: "not_found" }));
    await expect(defaultPlanApi.softDelete("p1")).rejects.toThrow();
  });
});
