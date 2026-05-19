// Unit tests for GET /api/integrations/strava/mobile-bounce.
//
// The route is a stateless 302 from the Strava-registered callback domain
// to the Flutter app's da2:// deep link. No DB access, no logging of
// code/state.
//
// Scenarios:
// - Happy path: ?code+state → 302 with code+state preserved
// - Error path: ?error=access_denied → 302 with error preserved
// - Allowlist: unknown query params are dropped (no injection into deep link)
// - Empty: no params → 302 to bare da2://strava-oauth

import { describe, expect, it } from "vitest";

import { GET } from "@/../app/api/integrations/strava/mobile-bounce/route";

function makeReq(query: Record<string, string>): Request {
  const url = new URL("https://da2-one.vercel.app/api/integrations/strava/mobile-bounce");
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString(), { method: "GET" });
}

describe("GET /api/integrations/strava/mobile-bounce", () => {
  it("redirects ?code + ?state to da2://strava-oauth, preserving both", async () => {
    const res = await GET(makeReq({ code: "abc123", state: "signed-nonce" }));
    expect(res.status).toBe(302);
    const loc = res.headers.get("location");
    expect(loc).toBeTruthy();
    const target = new URL(loc!);
    expect(target.protocol).toBe("da2:");
    expect(target.host).toBe("strava-oauth");
    expect(target.searchParams.get("code")).toBe("abc123");
    expect(target.searchParams.get("state")).toBe("signed-nonce");
  });

  it("preserves ?scope alongside code+state", async () => {
    const res = await GET(
      makeReq({ code: "c", state: "s", scope: "activity:read,profile:read_all" }),
    );
    expect(res.status).toBe(302);
    const target = new URL(res.headers.get("location")!);
    expect(target.searchParams.get("scope")).toBe(
      "activity:read,profile:read_all",
    );
  });

  it("forwards ?error=access_denied verbatim", async () => {
    const res = await GET(makeReq({ error: "access_denied" }));
    expect(res.status).toBe(302);
    const target = new URL(res.headers.get("location")!);
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("code")).toBeNull();
  });

  it("drops non-allowlisted query params (no deep-link injection)", async () => {
    const res = await GET(
      makeReq({
        code: "c",
        state: "s",
        // Crafted params an attacker might add:
        evil: "<script>",
        callback: "https://attacker.example",
        next: "..",
      }),
    );
    const target = new URL(res.headers.get("location")!);
    expect(target.searchParams.get("evil")).toBeNull();
    expect(target.searchParams.get("callback")).toBeNull();
    expect(target.searchParams.get("next")).toBeNull();
    expect(target.searchParams.get("code")).toBe("c");
    expect(target.searchParams.get("state")).toBe("s");
  });

  it("redirects with no params to bare da2://strava-oauth", async () => {
    const res = await GET(makeReq({}));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("da2://strava-oauth");
  });
});
