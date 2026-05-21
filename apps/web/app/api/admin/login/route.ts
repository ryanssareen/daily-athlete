// POST /api/admin/login
//
// Shared-password gate. Order: CSRF (fail-closed) -> lockout -> parse ->
// constant-time password compare -> on success, mint a server-backed signed
// session cookie. The login route itself sets the session cookie, so it is
// state-changing and carries the same Sec-Fetch-Site guard as every other
// admin mutation.

import { NextResponse } from "next/server";

import { ADMIN_COOKIE_NAME, adminCookieAttrs } from "@/auth/admin-cookie";
import {
  clearLoginAttempts,
  clientIp,
  createAdminSession,
  evaluateLockout,
  isSameOriginRequest,
  parseSessionToken,
  recordLoginAttempt,
  verifyAdminPassword,
} from "@/auth/admin-session";
import { writeAudit } from "@/db/admin-audit";

interface LoginBody {
  password?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(request.headers)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ip = clientIp(request.headers);
  const lock = await evaluateLockout(ip);
  if (!lock.allowed) {
    await writeAudit({ action: "admin.login.locked", ip });
    return NextResponse.json(
      { error: "locked" },
      {
        status: 429,
        headers: { "Retry-After": String(lock.retryAfterSeconds) },
      }
    );
  }

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const password = typeof body.password === "string" ? body.password : "";

  if (!verifyAdminPassword(password)) {
    await recordLoginAttempt(ip, false);
    await writeAudit({ action: "admin.login.failure", ip });
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  await recordLoginAttempt(ip, true);
  await clearLoginAttempts(ip);
  const { token, maxAgeSeconds } = await createAdminSession();
  await writeAudit({
    action: "admin.login.success",
    ip,
    sessionId: parseSessionToken(token)?.sessionId ?? null,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, token, adminCookieAttrs(maxAgeSeconds));
  return res;
}
