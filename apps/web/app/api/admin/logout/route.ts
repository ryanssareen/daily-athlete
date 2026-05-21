// POST /api/admin/logout — revoke the session row and clear the cookie.
//
// Revocation is server-side (admin_sessions.revoked_at) so the session dies
// even if the cookie lingers anywhere. CSRF-guarded like every admin mutation.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ADMIN_COOKIE_NAME, adminCookieAttrs } from "@/auth/admin-cookie";
import {
  clientIp,
  isSameOriginRequest,
  parseSessionToken,
  revokeAdminSession,
} from "@/auth/admin-session";
import { writeAudit } from "@/db/admin-audit";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(request.headers)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const store = await cookies();
  const parsed = parseSessionToken(store.get(ADMIN_COOKIE_NAME)?.value);
  if (parsed) {
    await revokeAdminSession(parsed.sessionId);
  }
  await writeAudit({
    action: "admin.logout",
    ip: clientIp(request.headers),
    sessionId: parsed?.sessionId ?? null,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, "", adminCookieAttrs(0));
  return res;
}
