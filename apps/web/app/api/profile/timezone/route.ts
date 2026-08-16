// PATCH /api/profile/timezone
//
// Self-service timezone capture. users.timezone defaults to 'UTC' at row
// creation (migration 0001) and nothing ever wrote the athlete's real
// timezone into it -- every athlete's workout times and dashboard greeting
// rendered in UTC regardless of where they actually live. This route lets
// the browser report its detected IANA timezone (Intl.DateTimeFormat) and
// self-heals the stored value; see @/components/timezone-sync for the
// client-side caller, mounted once per session in (athlete)/layout.tsx.
//
// No id is accepted from the client -- the row to update is resolved from
// the authenticated caller only, same safety-by-construction shape as
// /api/athlete/coach/disconnect.
//
// Admin client, not the RLS-scoped one, despite users_self_update already
// permitting self-writes to timezone (migration 0010's comment confirms
// this column is intentionally RLS-updatable, unlike role_flags). The RLS
// client from @/auth/server is bound to the COOKIE session only --
// resolveAuth() validates a Bearer token for its return value but never
// attaches it to this client's Postgrest requests. A mobile (Bearer) caller
// would hit RLS as anon, auth.uid() = id would be NULL = id, and the UPDATE
// would silently match zero rows instead of erroring. Admin client +
// explicit .eq("id", ...) is correct here specifically because this route
// must serve both auth surfaces -- see KTD1 in
// docs/plans/2026-08-15-001-feat-plan-history-archive-delete-plan.md for
// the same reasoning applied to another dual-surface route.

import { NextResponse } from "next/server";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";

function isValidIanaTimezone(tz: string): boolean {
  try {
    // Throws RangeError for a syntactically invalid timezone identifier.
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_input", message: "request body was not valid JSON" },
      { status: 400 }
    );
  }

  const timezone =
    rawBody && typeof rawBody === "object" && "timezone" in rawBody
      ? (rawBody as { timezone: unknown }).timezone
      : undefined;

  if (typeof timezone !== "string" || timezone.length === 0 || timezone.length > 100) {
    return NextResponse.json(
      { error: "invalid_input", message: "timezone must be a non-empty IANA timezone string" },
      { status: 400 }
    );
  }
  if (!isValidIanaTimezone(timezone)) {
    return NextResponse.json(
      { error: "invalid_input", message: `unrecognized timezone: ${timezone}` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  // service-role: explicit user filter required
  const { error: updateErr } = await admin
    .from("users")
    .update({ timezone })
    .eq("id", user.id);

  if (updateErr) {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
