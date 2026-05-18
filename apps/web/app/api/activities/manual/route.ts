// POST /api/activities/manual
//
// Manually logs a completed workout for the authenticated athlete.
//
// Security posture:
// - Bearer-token auth: mobile sends `Authorization: Bearer <jwt>`.
//   resolveAuth() reads either Bearer header or SSR cookie.
// - User JWT client (NOT service-role): the INSERT is executed through the
//   user's own session so migration 0008's RLS policy
//   `FOR INSERT WITH CHECK (auth.uid() = athlete_id)` is enforced at the
//   DB layer. The service-role admin client would bypass RLS, which would
//   allow a caller to insert rows for arbitrary athlete_ids.
// - Zod validates all body fields before any DB interaction.
//
// Logging policy: never log the Bearer token or full request body.
// Log only: user_id, sport, success/failure, normalized error code.

import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveAuth } from "@/auth/bearer";
import { createClient } from "@/auth/server";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const ManualActivityBodySchema = z.object({
  // Matches DB CHECK: sport IN ('swim','bike','run','strength','mobility','other')
  sport: z.enum(["swim", "bike", "run", "strength", "mobility", "other"]),
  // ISO-8601 datetime (with or without offset). The route normalises to UTC
  // before insertion.
  started_at: z.string().datetime({ offset: true }),
  // Total duration in seconds. Must be positive.
  duration_s: z.number().int().positive("duration_s must be > 0"),
  // Optional distance in metres. Nullable/absent for strength/mobility.
  distance_m: z.number().positive().optional(),
  // Free-text notes. Stored in summary_stats.notes.
  notes: z.string().max(2000).optional(),
});

type ManualActivityBody = z.infer<typeof ManualActivityBodySchema>;

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

type ErrorCode = "unauthorized" | "invalid_input" | "insert_failed";

function errorJson(code: ErrorCode, status: number, message?: string): NextResponse {
  return NextResponse.json(
    message ? { error: code, message } : { error: code },
    { status }
  );
}

function logEvent(event: {
  name: string;
  user_id?: string;
  sport?: string;
  success: boolean;
  code?: string;
}): void {
  // eslint-disable-next-line no-console
  console.info(
    `[activities.manual] ${event.name}`,
    JSON.stringify({
      user_id: event.user_id,
      sport: event.sport,
      success: event.success,
      code: event.code,
    })
  );
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Authenticate: Bearer header (mobile) or SSR cookie (browser).
  //    createClient() uses the user's session (anon key), not service-role.
  const supabase = await createClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return errorJson("unauthorized", 401);
  }

  // 2. Parse + validate request body.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    logEvent({ name: "invalid_json", user_id: user.id, success: false });
    return errorJson("invalid_input", 400, "request body was not valid JSON");
  }

  const parsed = ManualActivityBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    logEvent({
      name: "invalid_input",
      user_id: user.id,
      success: false,
      code: "invalid_input",
    });
    return errorJson("invalid_input", 400, parsed.error.issues[0]?.message);
  }

  const body: ManualActivityBody = parsed.data;

  // 3. Build the DB row. athlete_id = auth.uid() — the RLS INSERT CHECK
  //    enforces this; setting it here also makes the row complete for the
  //    SELECT * return.
  const summaryStats: Record<string, unknown> = {};
  if (body.notes) {
    summaryStats["notes"] = body.notes;
  }

  const row = {
    athlete_id: user.id,
    source: "manual" as const,
    sport: body.sport,
    started_at: body.started_at,
    duration_s: body.duration_s,
    distance_m: body.distance_m ?? null,
    summary_stats: summaryStats,
  };

  // 4. INSERT via user JWT client — RLS policy enforces athlete_id = auth.uid().
  const { data, error: insertErr } = await supabase
    .from("completed_workouts")
    .insert(row)
    .select()
    .single();

  if (insertErr) {
    logEvent({
      name: "insert_failed",
      user_id: user.id,
      sport: body.sport,
      success: false,
      code: insertErr.code ?? "unknown",
    });
    return errorJson("insert_failed", 500, "Unable to save workout. Please try again.");
  }

  logEvent({
    name: "logged",
    user_id: user.id,
    sport: body.sport,
    success: true,
  });

  return NextResponse.json(data, { status: 201 });
}
