/**
 * /api/health is a pure-function liveness probe — no auth, no DB. The unit
 * test calls the route's GET export directly and asserts shape parity with
 * the Python implementation in `apps/api/src/api/health.py`.
 *
 * No Postgres bootstrap needed for this file, but it still runs under the
 * shared globalSetup; that's a no-op cost.
 */
import { describe, expect, it } from "vitest";

import { GET } from "@/../app/api/health/route";

describe("GET /api/health", () => {
  it("returns 200 with the canonical {status: 'ok'} body", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("emits Content-Type application/json", async () => {
    const res = await GET();
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });
});
