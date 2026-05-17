// POST /api/coach/workouts
//
// Allows a coach to assign a planned workout to one of their linked athletes.
//
// Auth flow:
//   1. resolveAuth() — establishes which user is calling.
//   2. Verify caller has 'coach' in role_flags.
//   3. Verify an active coach_athlete_link exists between the coach and the
//      target athlete (prevents a coach assigning workouts to unlinked athletes).
//   4. INSERT into planned_workouts using the service-role client with
//      edited_by_kind = 'coach' and edited_by_user_id = coach's user_id.
//
// The service-role client is necessary because the athlete's INSERT RLS policy
// on planned_workouts only allows the athlete (auth.uid() = athlete_id) to
// insert their own rows. The coach INSERT goes through service-role, with the
// coach-link and role_flags checks acting as the access control layer.
//
// Returns 201 with the created row.

import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";

// Sport values must match the DB CHECK constraint and packages/shared Sport enum.
const SportSchema = z.enum([
  "swim",
  "bike",
  "run",
  "strength",
  "mobility",
  "other",
]);

const CoachWorkoutBodySchema = z.object({
  athlete_id: z.string().uuid("athlete_id must be a valid UUID"),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "scheduled_date must be YYYY-MM-DD",
  }),
  sport: SportSchema,
  structure: z.record(z.unknown()).optional(),
  planned_load: z.number().positive().optional(),
  rationale: z.string().max(2000).optional(),
});

function logEvent(event: {
  name: string;
  coach_id?: string;
  athlete_id?: string;
  success: boolean;
  code?: string;
}): void {
  // eslint-disable-next-line no-console
  console.info(
    `[coach.workouts] ${event.name}`,
    JSON.stringify({
      coach_id: event.coach_id,
      athlete_id: event.athlete_id,
      success: event.success,
      code: event.code,
    }),
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Authenticate.
  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Parse + validate body.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_input", message: "request body was not valid JSON" },
      { status: 400 },
    );
  }
  const parsed = CoachWorkoutBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // 3. Verify the caller is a coach.
  // We use the user JWT client (supabase) to read role_flags — RLS ensures
  // the caller can only read their own row.
  const { data: userRow, error: roleErr } = await supabase
    .from("users")
    .select("role_flags")
    .eq("id", user.id)
    .maybeSingle<{ role_flags: string[] }>();

  if (roleErr || !userRow) {
    logEvent({ name: "role_lookup_failed", coach_id: user.id, success: false });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (!userRow.role_flags.includes("coach")) {
    logEvent({
      name: "not_a_coach",
      coach_id: user.id,
      athlete_id: body.athlete_id,
      success: false,
      code: "forbidden",
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 4. Verify an active coach-athlete link exists.
  const admin = createAdminClient();
  // service-role: explicit user filter required
  const { data: link, error: linkErr } = await admin
    .from("coach_athlete_links")
    .select("id")
    .eq("coach_user_id", user.id)
    .eq("athlete_user_id", body.athlete_id)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>();

  if (linkErr) {
    logEvent({
      name: "link_lookup_failed",
      coach_id: user.id,
      athlete_id: body.athlete_id,
      success: false,
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (!link) {
    logEvent({
      name: "not_linked",
      coach_id: user.id,
      athlete_id: body.athlete_id,
      success: false,
      code: "forbidden",
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 5. INSERT the planned workout via service-role.
  // service-role: explicit user filter required (athlete_id = body.athlete_id)
  const { data: newWorkout, error: insertErr } = await admin
    .from("planned_workouts")
    .insert({
      athlete_id: body.athlete_id,
      scheduled_date: body.scheduled_date,
      sport: body.sport,
      structure: body.structure ?? {},
      planned_load: body.planned_load ?? null,
      rationale: body.rationale ?? null,
      edited_by_kind: "coach",
      edited_by_user_id: user.id,
    })
    .select()
    .single();

  if (insertErr || !newWorkout) {
    logEvent({
      name: "insert_failed",
      coach_id: user.id,
      athlete_id: body.athlete_id,
      success: false,
      code: insertErr?.message,
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  logEvent({
    name: "workout_assigned",
    coach_id: user.id,
    athlete_id: body.athlete_id,
    success: true,
  });

  return NextResponse.json(newWorkout, { status: 201 });
}
