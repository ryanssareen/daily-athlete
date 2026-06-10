// GET /api/weekly-review
//
// Lists the AI adaptive proposals relevant to the caller (plan Unit 6):
//   - For ANY caller: their own proposals (athlete_id = caller).
//   - For a COACH caller: additionally, their actively-linked athletes'
//     proposals whose recipient = 'coach' (the coach is the accepter on the
//     athlete's behalf, per the recipient-routing decision).
//
// Auth surface: Bearer token (Flutter) or cookie session (browser), resolved
// through resolveAuth() exactly like the status route.
//
// Agent-native: this is a resource-shaped, semantically-named endpoint; an
// agent can GET the list, then drive accept/reject on a specific [id].
//
// POST /api/weekly-review (Unit 10) — "request a replan".
//
// The athlete/coach-initiated entry into the SAME single adaptive-engine runner
// (`adaptive/run.requested`). Covers four trigger kinds:
//   - manual         (R11) → plan-scoped off-cycle replan.
//   - schedule_shock (B3)  → plan-scoped re-periodize for changed availability.
//   - event_change   (B4)  → plan-scoped reshape for a moved/cancelled event.
//   - workout_swap   (B7)  → workout-scoped single-workout alternative.
//
// Posture (per plan): gate on `ai_plans` (402 on miss), best-effort enqueue +
// 202 Accepted. An enqueue failure is logged but still returns 202 — we don't
// roll anything back because nothing was written yet; the engine run is the only
// side effect and the caller can retry. On-demand triggers ALWAYS run (unique
// dedup_key), so the runner's idempotency never collapses two requests.
//
// B3/B4 AUTOMATIC enqueue-on-edit is DEFERRED: there is no `plans.event_date`
// writer endpoint and no availability *edit* endpoint today (only one-time
// onboarding). Per the plan's Unit 10 note we do NOT invent those endpoints;
// B3/B4 are covered here via this explicit request-a-replan POST. When the
// event-edit / availability-edit endpoints land they should call
// sendOnDemandTrigger('event_change' / 'schedule_shock') on change.

import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

import type { WeeklyReviewRow } from "@da2/shared";

import { isLinkedCoach } from "@/ai/adaptive/recipient-auth";
import {
  type OnDemandTriggerKind,
  sendOnDemandTrigger,
} from "@/ai/adaptive/triggers/on-demand";
import { resolveAuth } from "@/auth/bearer";
import { requireEntitlement } from "@/auth/entitlements";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { inngest } from "@/inngest/client";

const PROPOSAL_COLUMNS =
  "id, athlete_id, plan_id, trigger_kind, scope, recipient, status, " +
  "proposed_changes, narrative, event_date_snapshot, earliest_affected_date, " +
  "generated_at, decided_at, created_at, deleted_at";

export async function GET(request: Request): Promise<NextResponse> {
  // 1. Authenticate the caller.
  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // 2. The caller's own proposals.
  // service-role: explicit user filter required
  const { data: ownRows, error: ownErr } = await admin
    .from("weekly_reviews")
    .select(PROPOSAL_COLUMNS)
    .eq("athlete_id", user.id)
    .is("deleted_at", null)
    .order("generated_at", { ascending: false });

  if (ownErr) {
    console.error("ownErr:", ownErr);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  const byId = new Map<string, WeeklyReviewRow>();
  for (const r of (ownRows ?? []) as unknown as WeeklyReviewRow[]) byId.set(r.id, r);

  // 3. If the caller is a coach, add their linked athletes' coach-recipient
  //    proposals. We resolve the linked athlete ids first, then filter the
  //    proposals to recipient='coach' for exactly those athletes.
  // service-role: explicit user filter required (coach side)
  const { data: links, error: linksErr } = await admin
    .from("coach_athlete_links")
    .select("athlete_user_id")
    .eq("coach_user_id", user.id)
    .eq("status", "active")
    .is("deleted_at", null);

  if (linksErr) {
    console.error("linksErr:", linksErr);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  const athleteIds = (links ?? [])
    .map((l) => l.athlete_user_id as string)
    .filter((id) => id !== user.id);

  if (athleteIds.length > 0) {
    // service-role: explicit athlete filter required (in() over the verified
    // linked-athlete set; recipient='coach' scopes to coach-routed proposals).
    const { data: coachRows, error: coachErr } = await admin
      .from("weekly_reviews")
      .select(PROPOSAL_COLUMNS)
      .in("athlete_id", athleteIds)
      .eq("recipient", "coach")
      .is("deleted_at", null)
      .order("generated_at", { ascending: false });

    if (coachErr) {
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    for (const r of (coachRows ?? []) as unknown as WeeklyReviewRow[])
      byId.set(r.id, r);
  }

  const proposals = Array.from(byId.values()).sort((a, b) =>
    a.generated_at < b.generated_at ? 1 : a.generated_at > b.generated_at ? -1 : 0
  );

  return NextResponse.json({ proposals }, { status: 200 });
}

// ---------------------------------------------------------------------------
// POST — request a replan (Unit 10)
// ---------------------------------------------------------------------------

// `workout_id` is required iff trigger_kind is 'workout_swap' (it identifies the
// single workout to swap); ignored otherwise. We model this as one object with a
// superRefine rather than a discriminated union so the 400 message is clear.
const RequestReplanSchema = z
  .object({
    trigger_kind: z.enum([
      "manual",
      "schedule_shock",
      "event_change",
      "workout_swap",
    ]),
    workout_id: z.string().uuid().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.trigger_kind === "workout_swap" && !val.workout_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workout_id"],
        message: "workout_id is required for workout_swap",
      });
    }
  });

function logReplan(event: {
  name: string;
  user_id?: string;
  athlete_id?: string;
  trigger_kind?: string;
  success: boolean;
  code?: string;
}): void {
  // Never log request bodies verbatim (may carry personal schedule data).
  console.info(
    `[weekly-review.replan] ${event.name}`,
    JSON.stringify({
      user_id: event.user_id,
      athlete_id: event.athlete_id,
      trigger_kind: event.trigger_kind,
      success: event.success,
      code: event.code,
    }),
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Authenticate the caller (Bearer or cookie), same as the status route.
  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Parse + validate the body.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_input", message: "request body was not valid JSON" },
      { status: 400 },
    );
  }

  const parsed = RequestReplanSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { trigger_kind, workout_id } = parsed.data;

  const admin = createAdminClient();

  // 3. Resolve the target athlete + authorize the caller.
  //    For non-swap triggers the caller IS the athlete (acts on their own
  //    plan). For workout_swap we resolve the workout's owner and verify the
  //    caller is that owner OR an actively-linked coach, mirroring the
  //    status-route owner-or-linked-coach gate.
  let athleteId = user.id;
  if (trigger_kind === "workout_swap" && workout_id) {
    // service-role: explicit id filter; the ownership/coach check below is the
    // security boundary.
    const { data: workout, error: fetchErr } = await admin
      .from("planned_workouts")
      .select("athlete_id")
      .eq("id", workout_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (fetchErr) {
      logReplan({
        name: "workout_lookup_failed",
        user_id: user.id,
        trigger_kind,
        success: false,
        code: "internal",
      });
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }
    if (!workout) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    if (workout.athlete_id !== user.id) {
      let allowed = false;
      try {
        allowed = await isLinkedCoach(admin, user.id, workout.athlete_id as string);
      } catch {
        return NextResponse.json({ error: "internal" }, { status: 500 });
      }
      if (!allowed) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }
    athleteId = workout.athlete_id as string;
  }

  // 4. Entitlement gate — don't spend an LLM run for a free user. 402 on miss.
  //    Checked against the target athlete (the run acts on their plan).
  const gate = await requireEntitlement(admin, athleteId, "ai_plans");
  if (gate) {
    logReplan({
      name: "unentitled",
      user_id: user.id,
      athlete_id: athleteId,
      trigger_kind,
      success: false,
      code: "payment_required",
    });
    return gate;
  }

  // 5. Best-effort enqueue + 202. Map trigger_kind → scope and send the generic
  //    runner event with a UNIQUE dedup_key (so on-demand runs always execute).
  //    An enqueue failure is logged but STILL returns 202 — nothing was written
  //    to roll back, and the caller can retry.
  try {
    await sendOnDemandTrigger(inngest.send.bind(inngest), {
      athleteId,
      triggerKind: trigger_kind as OnDemandTriggerKind,
    });
  } catch (err) {
    logReplan({
      name: "enqueue_failed",
      user_id: user.id,
      athlete_id: athleteId,
      trigger_kind,
      success: false,
      code: err instanceof Error ? err.message : "enqueue_error",
    });
    return NextResponse.json({ status: "accepted" }, { status: 202 });
  }

  logReplan({
    name: "enqueued",
    user_id: user.id,
    athlete_id: athleteId,
    trigger_kind,
    success: true,
  });
  return NextResponse.json({ status: "accepted" }, { status: 202 });
}
