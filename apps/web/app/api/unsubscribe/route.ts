// POST /api/unsubscribe — perform the unsubscribe a signed link authorizes.
//
// A POST, deliberately, even though the link in the email is a GET.
//
// WHY THE SPLIT. Mail clients, corporate link scanners, and preview crawlers
// FETCH the URLs in an email before a human ever clicks. If the bare GET
// performed the state change, athletes would be silently unsubscribed by their
// own mail provider — a bug that is invisible in testing and looks like "the
// emails just stopped" in production. So /unsubscribe (the page) only renders,
// and the change happens here on an explicit action.
//
// The token is a capability, not authentication: it names one user and one
// cadence, it can only switch a preference OFF, and nothing else in the app
// accepts it. See src/email/unsubscribe-token.ts.
//
// Service-role, necessarily: by definition there is no session on this request.

import "server-only";

import { NextResponse } from "next/server";

import { createAdminClient } from "@/db/admin";
import { preferenceColumnFor, verifyUnsubscribeToken } from "@/email/unsubscribe-token";

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const token = (body as { token?: unknown } | null)?.token;
  if (typeof token !== "string" || token.length === 0) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  const verified = verifyUnsubscribeToken(token);
  if (!verified.ok) {
    // ONE generic response for every failure mode. Distinguishing "expired"
    // from "bad signature" in the response would let someone probing tokens
    // learn which parts they got right; the reason is logged, not returned.
    console.warn("[unsubscribe] token rejected", { reason: verified.reason });
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  const admin = createAdminClient();
  const column = preferenceColumnFor(verified.cadence);

  // service-role: explicit user filter required — the id comes from the SIGNED
  // payload, never from the request body.
  const { error } = await admin
    .from("users")
    .update({ [column]: false })
    .eq("id", verified.userId);

  if (error) {
    console.error("[unsubscribe] update failed", {
      cadence: verified.cadence,
      message: error.message,
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  // Idempotent by construction: setting an already-false column to false is a
  // no-op, so a second click succeeds rather than erroring at someone who is
  // already unsubscribed.
  return NextResponse.json({ ok: true, cadence: verified.cadence }, { status: 200 });
}
