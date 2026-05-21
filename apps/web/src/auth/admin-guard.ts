import "server-only";

// requireAdmin — the authoritative session gate for every /api/admin route.
// Middleware only checks cookie presence at the Edge; this verifies the HMAC +
// the live, unrevoked, unexpired DB row. Routes compose it with
// isSameOriginRequest (CSRF) for state-changing methods.
//
// Reads the cookie straight off the request's Cookie header (rather than
// next/headers cookies()) so it's trivially testable with a plain Request.

import { NextResponse } from "next/server";

import { ADMIN_COOKIE_NAME } from "@/auth/admin-cookie";
import { verifyAdminSession } from "@/auth/admin-session";

export type AdminGate =
  | { ok: true; sessionId: string }
  | { ok: false; response: NextResponse };

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * Verify the admin session on an /api/admin request. On failure returns a
 * ready-to-send 401 in `response`; on success returns the session id (for
 * audit `source`).
 */
export async function requireAdmin(request: Request): Promise<AdminGate> {
  const token = readCookie(request.headers.get("cookie"), ADMIN_COOKIE_NAME);
  const { valid, sessionId } = await verifyAdminSession(token);
  if (!valid || !sessionId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, sessionId };
}
