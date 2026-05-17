// PATCH /api/coach/links/[id]/archive
//
// Allows a coach to remove an athlete from their roster by soft-deleting the
// coach_athlete_link row (status = 'archived', deleted_at = now()).
//
// Auth flow:
//   1. resolveAuth() — establishes which user is calling.
//   2. Look up the link by [id] — if not found, return 404.
//   3. Verify coach_athlete_links.coach_user_id = auth.uid() — if not, return 403.
//   4. UPDATE status = 'archived', deleted_at = now().
//
// We use the service-role client for the lookup and update to avoid RLS
// complications with the UPDATE policy (which allows both coach and athlete
// to update). The coach_user_id check is the authorization guard.
//
// Returns 204 No Content on success.

import { NextResponse } from "next/server";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";

function logEvent(event: {
  name: string;
  coach_id?: string;
  link_id?: string;
  success: boolean;
  code?: string;
}): void {
  // eslint-disable-next-line no-console
  console.info(
    `[coach.links.archive] ${event.name}`,
    JSON.stringify({
      coach_id: event.coach_id,
      link_id: event.link_id,
      success: event.success,
      code: event.code,
    }),
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // 1. Authenticate.
  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: linkId } = await params;
  if (!linkId) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const admin = createAdminClient();

  // 2. Look up the link.
  // service-role: explicit user filter required
  const { data: link, error: lookupErr } = await admin
    .from("coach_athlete_links")
    .select("id, coach_user_id, status")
    .eq("id", linkId)
    .maybeSingle<{ id: string; coach_user_id: string; status: string }>();

  if (lookupErr) {
    logEvent({
      name: "link_lookup_failed",
      coach_id: user.id,
      link_id: linkId,
      success: false,
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (!link) {
    logEvent({
      name: "link_not_found",
      coach_id: user.id,
      link_id: linkId,
      success: false,
      code: "not_found",
    });
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 3. Verify ownership — only the coach who created the link can archive it.
  if (link.coach_user_id !== user.id) {
    logEvent({
      name: "ownership_mismatch",
      coach_id: user.id,
      link_id: linkId,
      success: false,
      code: "forbidden",
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 4. Soft-delete (archive) the link.
  // service-role: explicit user filter required
  const { error: updateErr } = await admin
    .from("coach_athlete_links")
    .update({
      status: "archived",
      deleted_at: new Date().toISOString(),
    })
    .eq("id", linkId);

  if (updateErr) {
    logEvent({
      name: "update_failed",
      coach_id: user.id,
      link_id: linkId,
      success: false,
      code: updateErr.message,
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  logEvent({
    name: "archived",
    coach_id: user.id,
    link_id: linkId,
    success: true,
  });

  return new NextResponse(null, { status: 204 });
}
