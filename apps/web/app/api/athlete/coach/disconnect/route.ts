// POST|DELETE /api/athlete/coach/disconnect
//
// Lets an athlete leave their current coach by archiving (soft-deleting) their
// active coach_athlete_link. An athlete has at most one active link (enforced
// by the partial unique index in migration 0010), so no link id is accepted
// from the client — it is resolved from the authenticated caller. That makes
// the endpoint safe by construction: a caller can only ever archive their own
// link, never someone else's.
//
// Auth: Bearer token (Flutter app) or SSR cookie (web), via resolveAuth().
// POST supports HTML form posts; DELETE is for API clients. Both run identical
// logic. Returns 204 No Content on success — including the idempotent case
// where there was no active coach to remove, so a double-tap is harmless.

import { NextResponse } from "next/server";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { archiveAthleteCoachLink } from "@/db/roster";

function logEvent(event: {
  name: string;
  athlete_id?: string;
  coach_id?: string;
  success: boolean;
  code?: string;
}): void {
  // eslint-disable-next-line no-console
  console.info(
    `[athlete.coach.disconnect] ${event.name}`,
    JSON.stringify({
      athlete_id: event.athlete_id,
      coach_id: event.coach_id,
      success: event.success,
      code: event.code,
    }),
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  return disconnect(request);
}

export async function DELETE(request: Request): Promise<NextResponse> {
  return disconnect(request);
}

async function disconnect(request: Request): Promise<NextResponse> {
  // 1. Authenticate the caller (Bearer or cookie).
  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Archive the caller's own active link (resolved server-side from the
  //    session — the athlete_user_id filter is the authorization guard).
  const admin = createAdminClient();
  let archived: { linkId: string; coachId: string } | null;
  try {
    archived = await archiveAthleteCoachLink(admin, user.id);
  } catch (err) {
    logEvent({
      name: "archive_failed",
      athlete_id: user.id,
      success: false,
      code: err instanceof Error ? err.message : "internal_error",
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  logEvent({
    name: archived ? "disconnected" : "no_active_coach",
    athlete_id: user.id,
    coach_id: archived?.coachId,
    success: true,
  });

  return new NextResponse(null, { status: 204 });
}
