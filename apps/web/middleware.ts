// Coarse Edge gate for /admin + /api/admin. The Edge runtime can't run
// node:crypto or reach the DB, so this only checks COOKIE PRESENCE;
// authoritative verification (HMAC + live, unrevoked, unexpired row) lives in
// @/auth/admin-session, called from the (authed) layout and every /api/admin
// route. Defense in depth: middleware turns away the obviously-unauthenticated
// before they reach a render/handler, but is never the sole gate.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ADMIN_COOKIE_NAME, ADMIN_LOGIN_PATH } from "@/auth/admin-cookie";

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // The login page + login API must be reachable without a session.
  if (pathname === ADMIN_LOGIN_PATH || pathname === "/api/admin/login") {
    return NextResponse.next();
  }

  if (req.cookies.has(ADMIN_COOKIE_NAME)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = ADMIN_LOGIN_PATH;
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
