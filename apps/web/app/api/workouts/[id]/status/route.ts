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
// Attribution + audit log (plan Unit 2):
//   Every edit path stamps edited_by_kind ('athlete' for the owner, 'coach'
//   for a linked coach) and edited_by_user_id (the resolved caller) on the
//   planned_workouts row, and appends a workout_edits audit row (actor_role
//   matching, weekly_review_id = null for these direct edits). This makes the
//   coach-overwrite guardrail's edited_by_kind signal (plan Unit 4) trustworthy
//   and turns workout_edits into a COMPLETE edit log, not an AI-only one.
//
// Logging policy: log only user_id, workout_id, new status, success/failure.
// Never log request bodies verbatim (they may contain personal schedule data).

import { NextResponse } from "next/server";
import { z } from "zod";

import type { EditedByKind, WorkoutEditActorRole, WorkoutEditFieldDiff } from "@da2/shared";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { appendWorkoutEdit } from "@/db/workout-edits";

// edited_by_kind and workout_edits.actor_role share the same {athlete, coach}
// vocabulary for these direct (non-AI) edits, so one resolved value drives both.
type DirectEditorKind = Extract<EditedByKind, "athlete" | "coach"> &
  Extract<WorkoutEditActorRole, "athlete" | "coach">;

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
    notes: z.string().max(2000).optional(),
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
  // The resolved role doubles as the edit attribution (edited_by_kind /
  // workout_edits.actor_role) stamped on every edit path below (plan Unit 2).
  const isOwner = plannedWorkout.athlete_id === user.id;
  let editorKind: DirectEditorKind = "athlete";
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
    editorKind = "coach";
  }

  // 5. Perform the status update. Each helper stamps attribution
  // (edited_by_kind/edited_by_user_id) on the planned_workouts row and appends
  // a matching workout_edits audit row.
  const attribution: EditAttribution = {
    athleteId: plannedWorkout.athlete_id,
    editorKind,
    editorUserId: user.id,
  };
  try {
    if (body.status === "completed") {
      await _markCompleted(admin, plannedWorkout, attribution, body);
    } else if (body.status === "skipped") {
      await _markSkipped(admin, plannedWorkout, attribution);
    } else if (body.status === "moved") {
      await _markMoved(
        admin,
        plannedWorkout,
        attribution,
        body.scheduled_date
      );
    }
  } catch (err) {
    logEvent({
      name: "update_failed",
      user_id: user.id,
      workout_id: workoutId,
      status: body.status,
      success: false,
      code: err instanceof Error ? err.message : "internal",
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
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
// Edit attribution resolved from the authorization gate (plan Unit 2).
// Drives planned_workouts.edited_by_kind/edited_by_user_id and the
// workout_edits.actor_role/actor_user_id audit row on every edit path.
// ---------------------------------------------------------------------------

interface EditAttribution {
  /** Owner of the planned workout (workout_edits.athlete_id). */
  athleteId: string;
  /** 'athlete' (owner) or 'coach' (linked coach). */
  editorKind: DirectEditorKind;
  /** The resolved caller (edited_by_user_id / actor_user_id). */
  editorUserId: string;
}

// ---------------------------------------------------------------------------
// _markCompleted: insert completed_workout + workout_match atomically.
//
// Uses the complete_planned_workout Postgres RPC function when available.
// The RPC wraps both INSERTs in a transaction; if workout_matches insert
// fails, the completed_workout insert is rolled back automatically.
//
// The RPC owns only the completed/match writes and the status flip; attribution
// (edited_by_kind/edited_by_user_id) is stamped here in the route after the RPC
// succeeds, and a workout_edits audit row is appended (plan Unit 2 calls for the
// audit row on the RPC path to be appended in the route after the RPC succeeds).
// ---------------------------------------------------------------------------

async function _markCompleted(
  admin: ReturnType<typeof createAdminClient>,
  plannedWorkout: {
    id: string;
    athlete_id: string;
    sport: string;
    scheduled_date: string;
    status: string;
  },
  attribution: EditAttribution,
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

  // If the RPC exists and succeeded, we're done with the completed/match writes.
  if (!rpcErr) {
    // Stamp attribution (the RPC sets status + edited_at but not attribution),
    // then append the audit row for the RPC path.
    await _stampAttribution(admin, plannedWorkout.id, "completed", attribution);
    await _appendStatusEdit(plannedWorkout, "completed", attribution, admin);
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

  // Update planned workout status + attribution.
  await _stampAttribution(admin, plannedWorkout.id, "completed", attribution);
  await _appendStatusEdit(plannedWorkout, "completed", attribution, admin);
}

// ---------------------------------------------------------------------------
// _markSkipped: status -> 'skipped' with attribution + audit row
// ---------------------------------------------------------------------------

async function _markSkipped(
  admin: ReturnType<typeof createAdminClient>,
  plannedWorkout: { id: string; athlete_id: string; status: string },
  attribution: EditAttribution
): Promise<void> {
  await _stampAttribution(admin, plannedWorkout.id, "skipped", attribution);
  await _appendStatusEdit(plannedWorkout, "skipped", attribution, admin);
}

// ---------------------------------------------------------------------------
// _markMoved: move a planned workout to a new date with attribution + audit row
// ---------------------------------------------------------------------------

async function _markMoved(
  admin: ReturnType<typeof createAdminClient>,
  plannedWorkout: {
    id: string;
    athlete_id: string;
    scheduled_date: string;
    status: string;
  },
  attribution: EditAttribution,
  scheduledDate: string
): Promise<void> {
  // service-role: explicit user filter required
  const { error } = await admin
    .from("planned_workouts")
    .update({
      status: "moved",
      scheduled_date: scheduledDate,
      edited_at: new Date().toISOString(),
      edited_by_kind: attribution.editorKind,
      edited_by_user_id: attribution.editorUserId,
    })
    .eq("id", plannedWorkout.id);

  if (error) {
    throw new Error(`planned_workouts move failed: ${error.message}`);
  }

  // A move changes a plannable column (scheduled_date) — capture the date diff.
  await appendWorkoutEdit({
    admin,
    athleteId: attribution.athleteId,
    plannedWorkoutId: plannedWorkout.id,
    actorRole: attribution.editorKind,
    actorUserId: attribution.editorUserId,
    fieldDiff: {
      status: { from: plannedWorkout.status, to: "moved" },
      scheduled_date: {
        from: plannedWorkout.scheduled_date,
        to: scheduledDate,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// _stampAttribution: status + edited_at + attribution stamp on planned_workouts
// ---------------------------------------------------------------------------

async function _stampAttribution(
  admin: ReturnType<typeof createAdminClient>,
  workoutId: string,
  status: "skipped" | "completed",
  attribution: EditAttribution
): Promise<void> {
  // service-role: explicit user filter required
  const { error } = await admin
    .from("planned_workouts")
    .update({
      status,
      edited_at: new Date().toISOString(),
      edited_by_kind: attribution.editorKind,
      edited_by_user_id: attribution.editorUserId,
    })
    .eq("id", workoutId);

  if (error) {
    throw new Error(`planned_workouts status update failed: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// _appendStatusEdit: append a workout_edits audit row for a status flip
// (skipped/completed). The plannable change here is the status transition.
// ---------------------------------------------------------------------------

async function _appendStatusEdit(
  plannedWorkout: { id: string; status: string },
  newStatus: "skipped" | "completed",
  attribution: EditAttribution,
  admin: ReturnType<typeof createAdminClient>
): Promise<void> {
  const fieldDiff: WorkoutEditFieldDiff = {
    status: { from: plannedWorkout.status, to: newStatus },
  };
  await appendWorkoutEdit({
    admin,
    athleteId: attribution.athleteId,
    plannedWorkoutId: plannedWorkout.id,
    actorRole: attribution.editorKind,
    actorUserId: attribution.editorUserId,
    fieldDiff,
  });
}
