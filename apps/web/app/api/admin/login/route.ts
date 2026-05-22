// POST /api/admin/login
//
// Shared-password gate. Order: CSRF (fail-closed) -> lockout -> parse ->
// constant-time password compare -> on success, mint a server-backed signed
// session cookie. The login route itself sets the session cookie, so it is
// state-changing and carries the same Sec-Fetch-Site guard as every other
// admin mutation.
//
// ERROR LOGGING: the DB/crypto steps below have real throw sites that surface
// as opaque 500s (a misconfigured env makes createAdminClient() throw; a
// missing ADMIN_SESSION_SIGNING_KEY makes createAdminSession() throw; an
// un-migrated admin_sessions table makes the session insert throw). The whole
// flow runs inside a try/catch that logs a structured, non-PII payload naming
// the exact `phase` that failed, so a 500 in production points straight at the
// failing step instead of a bare stack trace. NEVER log the password or the
// session token — only phase, ip, and the error's name/message/code/stack.

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

// Coarse step labels for the catch-block log, so a 500 names the failing step.
// Non-PII by construction (a fixed enum), safe to persist in the audit trail.
type LoginPhase =
  | "lockout"
  | "record_failure"
  | "audit_failure"
  | "record_success"
  | "clear_attempts"
  | "create_session"
  | "audit_success";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(request.headers)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // clientIp/isSameOriginRequest are pure header reads (no throw), so they sit
  // outside the try; `ip` is captured here so the catch block can log it.
  const ip = clientIp(request.headers);
  let phase: LoginPhase = "lockout";

  try {
    const lock = await evaluateLockout(ip);
    if (!lock.allowed) {
      phase = "audit_failure";
      await writeAudit({ action: "admin.login.locked", ip });
      return NextResponse.json(
        { error: "locked" },
        {
          status: 429,
          headers: { "Retry-After": String(lock.retryAfterSeconds) },
        }
      );
    }

    // Body parse has its own catch (a malformed body is a 400, not a 500) and
    // never reaches the outer handler.
    let body: LoginBody;
    try {
      body = (await request.json()) as LoginBody;
    } catch {
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }
    const password = typeof body.password === "string" ? body.password : "";

    if (!verifyAdminPassword(password)) {
      phase = "record_failure";
      await recordLoginAttempt(ip, false);
      phase = "audit_failure";
      await writeAudit({ action: "admin.login.failure", ip });
      return NextResponse.json(
        { error: "invalid_credentials" },
        { status: 401 }
      );
    }

    phase = "record_success";
    await recordLoginAttempt(ip, true);
    phase = "clear_attempts";
    await clearLoginAttempts(ip);
    phase = "create_session";
    const { token, maxAgeSeconds } = await createAdminSession();
    phase = "audit_success";
    await writeAudit({
      action: "admin.login.success",
      ip,
      sessionId: parseSessionToken(token)?.sessionId ?? null,
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE_NAME, token, adminCookieAttrs(maxAgeSeconds));
    return res;
  } catch (err) {
    // The whole point of this route's instrumentation: name the failing step
    // and the underlying error (message/code/stack) without ever touching the
    // password or the minted token. `code` catches Postgres/PostgREST errors
    // (e.g. "42P01 undefined_table" => migration 0015 not applied in prod).
    const code =
      typeof (err as { code?: unknown })?.code === "string"
        ? (err as { code: string }).code
        : null;
    console.error(
      "[admin-login] unhandled error",
      JSON.stringify({
        phase,
        ip,
        name: err instanceof Error ? err.name : "unknown",
        message: err instanceof Error ? err.message : String(err),
        code,
        stack: err instanceof Error ? err.stack : null,
      })
    );
    // Best-effort, never-throws (see writeAudit). Records WHICH step failed in
    // the immutable trail; metadata stays non-PII (phase + error code only).
    await writeAudit({
      action: "admin.login.error",
      ip,
      metadata: { phase, code },
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
