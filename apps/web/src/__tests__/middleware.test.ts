// Tests for the coarse Edge middleware gate. Pure: it only inspects path +
// cookie presence, so no DB or crypto is involved. Authoritative verification
// is tested in admin-session(.db).test.ts.

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { middleware } from "../../middleware";

function req(path: string, opts: { cookie?: boolean } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = "da2-admin-session=x";
  return new NextRequest(new URL(`http://localhost:3000${path}`), { headers });
}

describe("admin middleware", () => {
  it("lets the login page through without a session", () => {
    expect(middleware(req("/admin/login")).headers.get("x-middleware-next")).toBe(
      "1"
    );
  });

  it("lets the login API through without a session", () => {
    expect(
      middleware(req("/api/admin/login")).headers.get("x-middleware-next")
    ).toBe("1");
  });

  it("redirects an unauthenticated admin page to /admin/login", () => {
    const res = middleware(req("/admin/backups"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/admin/login");
  });

  it("401s an unauthenticated admin API route", () => {
    expect(middleware(req("/api/admin/backups")).status).toBe(401);
  });

  it("lets an authenticated admin page through", () => {
    expect(
      middleware(req("/admin/backups", { cookie: true })).headers.get(
        "x-middleware-next"
      )
    ).toBe("1");
  });

  it("lets an authenticated admin API route through", () => {
    expect(
      middleware(req("/api/admin/users", { cookie: true })).headers.get(
        "x-middleware-next"
      )
    ).toBe("1");
  });
});
