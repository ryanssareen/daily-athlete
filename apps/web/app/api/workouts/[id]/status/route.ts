// POST /api/workouts/[id]/status
//
// Marks a planned workout as 'completed', 'skipped', or 'moved'.
//
// Auth surface: Bearer token (Flutter) or cookie session (browser).
// Both resolve through resolveAuth().
//
// Authorization:
//   The caller must be the athlete who owns the planned workout OR a
//   coach who is actively linked to that athlete via coach_athlete_links.
//
// For 'completed':
//   Inserts a completed_workouts row and a workout_matches row inside a
//   Postgres transaction via the complete_planned_workout RPC function.
//   If the RPC doesn't exist (older environments), falls back to two
//   sequential admin inserts guarded by a try/catch rollback pattern.
//   Using an RPC is preferred because it ensures atomicity: a failed
//   workout_matches insert won't leave an orphaned completed_workout.
//
// For 'skipped' / 'moved':
//   Updates planned_workouts.status only. No transaction needed.
//
// Logging policy: log only user_id, workout_id, new status, success/failure.
// Never log request bodies verbatim (they may contain personal schedule data).

import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";

// ---------------------------------------------------------------------------
// Request body schema
// ---------------------------------------------------------------------------

const StatusBodySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    // Optional fields for the completed_workout row.
    started_at: z.string().datetime().optional(),
    duration_s: z.number().int().positive().optional(),
    distance_m: z.number().positive().optional(),
    notes: z.string().optional(),
  }),
  z.object({
    status: z.literal("skipped"),
  }),
  z.object({
    status: z.literal("moved"),
    // Required when moving: the new date.
    scheduled_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "scheduled_date must be YYYY-MM-DD"),
  }),
]);

type StatusBody = z.infer<typeof StatusBodySchema>;

// ---------------------------------------------------------------------------
// Helper: structured log
// ---------------------------------------------------------------------------

function logEvent(event: {
  name: string;
  user_id?: string;
  workout_id?: string;
  status?: string;
  success: boolean;
  code?: string;
}): void {
  // eslint-disable-next-line no-console
  console.info(
    `[workouts.status] ${event.name}`,
    JSON.stringify({
      user_id: event.user_id,
      workout_id: event.workout_id,
      status: event.status,
      success: event.success,
      code: event.code,
    })
  );
}

// ---------------------------------------------------------------------------
// Helper: check coach authorization
// ---------------------------------------------------------------------------

async function isLinkedCoach(
  admin: ReturnType<typeof createAdminClient>,
  coachId: string,
  athleteId: string
): Promise<boolean> {
  // service-role: explicit user filter required
  const { data, error } = await admin
    .from("coach_athlete_links")
    .select("id")
    .eq("coach_user_id", coachId)
    .eq("athlete_user_id", athleteId)
    .eq("status", "active")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: workoutId } = await params;

  // 1. Authenticate the caller.
  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    logEvent({ name: "unauthorized", workout_id: workoutId, success: false });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Parse + validate the request body.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_input", message: "request body was not valid JSON" },
      { status: 400 }
    );
  }

  const parsed = StatusBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", message: parsed.error.message },
      { status: 400 }
    );
  }

  const body: StatusBody = parsed.data;
  const admin = createAdminClient();

  // 3. Fetch the planned_workout to verify ownership.
  // service-role: explicit user filter required
  const { data: plannedWorkout, error: fetchErr } = await admin
    .from("planned_workouts")
    .select("id, athlete_id, sport, scheduled_date, structure, status")
    .eq("id", workoutId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchErr || !plannedWorkout) {
    logEvent({
      name: "workout_not_found",
      user_id: user.id,
      workout_id: workoutId,
      success: false,
      code: "not_found",
    });
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 4. Authorization: caller must be the athlete OR a linked coach.
  const isOwner = plannedWorkout.athlete_id === user.id;
  if (!isOwner) {
    let coachAllowed: boolean;
    try {
      coachAllowed = await isLinkedCoach(
        admin,
        user.id,
        plannedWorkout.athlete_id
      );
    } catch {
      logEvent({
        name: "coach_check_failed",
        user_id: user.id,
        workout_id: workoutId,
        success: false,
        code: "internal",
      });
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }
    if (!coachAllowed) {
      logEvent({
        name: "forbidden",
        user_id: user.id,
        workout_id: workoutId,
        success: false,
        code: "forbidden",
      });
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // 5. Perform the status update.
  try {
    if (body.status === "completed") {
      await _markCompleted(admin, plannedWorkout, user.id, body);
    } else if (body.status === "skipped") {
      await _updateStatus(admin, workoutId, "skipped");
    } else if (body.status === "moved") {
      await _markMoved(admin, workoutId, body.scheduled_date);
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "internal error";
    logEvent({
      name: "update_failed",
      user_id: user.id,
      workout_id: workoutId,
      status: body.status,
      success: false,
      code: "internal",
    });
    return NextResponse.json(
      { error: "internal", message },
      { status: 500 }
    );
  }

  logEvent({
    name: "status_updated",
    user_id: user.id,
    workout_id: workoutId,
    status: body.status,
    success: true,
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

// ---------------------------------------------------------------------------
// _markCompleted: insert completed_workout + workout_match atomically.
//
// Uses the complete_planned_workout Postgres RPC function when available.
// The RPC wraps both INSERTs in a transaction; if workout_matches insert
// fails, the completed_workout insert is rolled back automatically.
// ---------------------------------------------------------------------------

async function _markCompleted(
  admin: ReturnType<typeof createAdminClient>,
  plannedWorkout: {
    id: string;
    athlete_id: string;
    sport: string;
    scheduled_date: string;
  },
  callerId: string,
  body: Extract<StatusBody, { status: "completed" }>
): Promise<void> {
  const now = new Date().toISOString();
  const startedAt = body.started_at ?? now;

  // Try RPC first (preferred — atomic transaction on the DB side).
  const { error: rpcErr } = await admin.rpc("complete_planned_workout", {
    p_planned_workout_id: plannedWorkout.id,
    p_athlete_id: plannedWorkout.athlete_id,
    p_sport: plannedWorkout.sport,
    p_started_at: startedAt,
    p_duration_s: body.duration_s ?? null,
    p_distance_m: body.distance_m ?? null,
    p_source: "manual",
  });

  // If the RPC exists and succeeded, we're done.
  if (!rpcErr) {
    // Also update planned_workout status to 'completed'.
    // The RPC may handle this already; if not, this update is idempotent.
    await admin
      .from("planned_workouts")
      .update({ status: "completed", edited_at: now })
      .eq("id", plannedWorkout.id);
    return;
  }

  // If RPC is not found (PGRST202 / code 404 from PostgREST) or doesn't
  // exist in the target environment, fall back to two sequential inserts.
  // This is not atomic but is acceptable for environments that don't yet
  // have the RPC deployed.
  //
  // service-role: explicit user filter required
  const completedWorkoutRow = {
    athlete_id: plannedWorkout.athlete_id,
    source: "manual" as const,
    started_at: startedAt,
    sport: plannedWorkout.sport,
    duration_s: body.duration_s ?? null,
    distance_m: body.distance_m ?? null,
    summary_stats: body.notes ? { notes: body.notes } : {},
  };

  const { data: insertedCW, error: cwErr } = await admin
    .from("completed_workouts")
    .insert(completedWorkoutRow)
    .select("id")
    .single();

  if (cwErr || !insertedCW) {
    throw new Error(
      `completed_workouts insert failed: ${cwErr?.message ?? "no data"}`
    );
  }

  // Insert workout_match.
  // service-role: explicit user filter required
  const { error: matchErr } = await admin.from("workout_matches").insert({
    planned_workout_id: plannedWorkout.id,
    completed_workout_id: insertedCW.id,
    method: "manual_user_link",
    confidence: 1,
    matched_at: now,
  });

  if (matchErr) {
    // Attempt to undo the completed_workout insert to avoid orphans.
    await admin
      .from("completed_workouts")
      .update({ deleted_at: now })
      .eq("id", insertedCW.id);

    throw new Error(`workout_matches insert failed: ${matchErr.message}`);
  }

  // Update planned workout status.
  // service-role: explicit user filter required
  await admin
    .from("planned_workouts")
    .update({ status: "completed", edited_at: now })
    .eq("id", plannedWorkout.id);
}

// ---------------------------------------------------------------------------
// _updateStatus: simple status update on planned_workouts
// ---------------------------------------------------------------------------

async function _updateStatus(
  admin: ReturnType<typeof createAdminClient>,
  workoutId: string,
  status: "skipped" | "completed"
): Promise<void> {
  // service-role: explicit user filter required
  const { error } = await admin
    .from("planned_workouts")
    .update({ status, edited_at: new Date().toISOString() })
    .eq("id", workoutId);

  if (error) {
    throw new Error(`planned_workouts status update failed: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// _markMoved: move a planned workout to a new date
// ---------------------------------------------------------------------------

async function _markMoved(
  admin: ReturnType<typeof createAdminClient>,
  workoutId: string,
  scheduledDate: string
): Promise<void> {
  // service-role: explicit user filter required
  const { error } = await admin
    .from("planned_workouts")
    .update({
      status: "moved",
      scheduled_date: scheduledDate,
      edited_at: new Date().toISOString(),
    })
    .eq("id", workoutId);

  if (error) {
    throw new Error(`planned_workouts move failed: ${error.message}`);
  }
}
