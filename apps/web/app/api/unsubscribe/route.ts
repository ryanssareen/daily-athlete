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
// TWO CALLERS, one behaviour. The token may arrive either in a JSON body (the
// confirmation page's fetch) or in the query string (RFC 8058 one-click, where
// the mail client POSTs the List-Unsubscribe URL with a form body of
// `List-Unsubscribe=One-Click` and no JSON at all). Supporting the query form
// is what makes it honest to advertise List-Unsubscribe-Post: a client that
// takes us at our word must actually succeed.
//
// A POST carrying a token in the query is still safe against the pre-fetch
// problem the page/route split exists for -- scanners and previewers issue
// GETs, and this route has no GET handler.
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

async function readToken(request: Request): Promise<string | null> {
  const fromQuery = new URL(request.url).searchParams.get("token");
  if (fromQuery) return fromQuery;

  // A one-click POST has a form body, not JSON, so a parse failure here is an
  // expected shape rather than an error -- it just means the token was not in
  // the body, and the query check above already had its chance.
  try {
    const body = (await request.json()) as { token?: unknown } | null;
    const token = body?.token;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const token = await readToken(request);
  if (token === null) {
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
