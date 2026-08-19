// GET/PATCH /api/profile/email-preferences
//
// Per-cadence opt-in for period-review digests (U8, KTD7).
//
// Admin client, not the RLS-scoped one, despite users_self_update already
// permitting self-writes. The client from @/auth/server is bound to the COOKIE
// session only -- resolveAuth validates a Bearer token for its return value but
// never attaches it to that client's PostgREST requests. A mobile caller would
// hit RLS as anon, `auth.uid() = id` would be NULL, and the UPDATE would
// silently match zero rows instead of erroring: the athlete taps the toggle, it
// appears to work, and nothing is saved. Admin client + explicit `.eq("id")` is
// the established fix for a dual-surface route in this repo -- see
// /api/profile/timezone, which was written after exactly that bug.
//
// No id is accepted from the client; the row is resolved from the
// authenticated caller only.

import "server-only";

import { NextResponse } from "next/server";

import type { EmailPreferences } from "@da2/shared";
import { EmailPreferencesUpdateSchema } from "@da2/shared";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";

interface PreferenceRow {
  email_weekly_review: boolean;
  email_monthly_review: boolean;
}

function toPreferences(row: PreferenceRow): EmailPreferences {
  return { weeklyReview: row.email_weekly_review, monthlyReview: row.email_monthly_review };
}

export async function GET(request: Request): Promise<NextResponse> {
  const authClient = await createServerClient();
  const { user, error: authErr } = await resolveAuth(authClient, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // service-role: explicit user filter required
  const { data, error } = await admin
    .from("users")
    .select("email_weekly_review, email_monthly_review")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    console.error("[email-prefs] read failed", { user_id: user.id, message: error?.message });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  return NextResponse.json(toPreferences(data as PreferenceRow), { status: 200 });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const authClient = await createServerClient();
  const { user, error: authErr } = await resolveAuth(authClient, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_input", message: "request body was not valid JSON" },
      { status: 400 },
    );
  }

  // `.strict()` on the schema means a client typo (`weekly_review`) is a 400
  // rather than a silent no-op the athlete reads as a successful save.
  const parsed = EmailPreferencesUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", message: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }

  // Only the named cadences are written -- an update naming one preference
  // must not reset the other to its default.
  const patch: Record<string, boolean> = {};
  if (parsed.data.weeklyReview !== undefined) patch.email_weekly_review = parsed.data.weeklyReview;
  if (parsed.data.monthlyReview !== undefined) {
    patch.email_monthly_review = parsed.data.monthlyReview;
  }

  const admin = createAdminClient();
  // service-role: explicit user filter required
  const { data, error } = await admin
    .from("users")
    .update(patch)
    .eq("id", user.id)
    .select("email_weekly_review, email_monthly_review")
    .maybeSingle();

  if (error || !data) {
    console.error("[email-prefs] update failed", { user_id: user.id, message: error?.message });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  return NextResponse.json(toPreferences(data as PreferenceRow), { status: 200 });
}
