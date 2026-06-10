// POST /api/plans — request an AI-generated training plan (Unit 5).
//
// Agent-native, resource-shaped entry point. Authorizes, gates on entitlement
// OR the one free trial (Unit 7), records a pending ai_generation_attempts row
// (the idempotency anchor), best-effort enqueues the generation worker, and
// returns 202. The plan is built + persisted off the request path by the
// plan/generate.requested worker and renders on the calendar via Realtime.
//
// Authz order is load-bearing (no paid-status oracle): resolve the target
// athlete and verify owner-or-linked-coach (403) BEFORE any entitlement/trial
// query runs. Free-text inputs live only in the RLS-protected attempt row — the
// Inngest event carries ids only.

import { NextResponse } from "next/server";

import { GeneratePlanInputSchema } from "@da2/shared";

import { isLinkedCoach } from "@/ai/adaptive/recipient-auth";
import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { resolveGenerationAccess } from "@/auth/trial";
import { createAdminClient } from "@/db/admin";
import { inngest } from "@/inngest/client";
import { PLAN_GENERATE_EVENT } from "@/inngest/functions/generate-plan";

function logRequest(event: {
  name: string;
  user_id?: string;
  athlete_id?: string;
  success: boolean;
  code?: string;
}): void {
  // Never log request bodies verbatim (carry injury free-text).
  console.info(
    `[plans.request] ${event.name}`,
    JSON.stringify({
      user_id: event.user_id,
      athlete_id: event.athlete_id,
      success: event.success,
      code: event.code,
    })
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Authenticate (Bearer or cookie).
  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Parse + validate the body (athlete_id UUID in body; free-text capped).
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_input", message: "request body was not valid JSON" },
      { status: 400 }
    );
  }
  const parsed = GeneratePlanInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", message: parsed.error.issues[0]?.message },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const athleteId = input.athlete_id;

  const admin = createAdminClient();

  // 3. Resolve target + authorize (owner or linked coach) BEFORE entitlement,
  //    so a non-owner targeting another athlete never probes paid status.
  let requesterKind: "owner" | "coach" = "owner";
  if (athleteId !== user.id) {
    let allowed = false;
    try {
      allowed = await isLinkedCoach(admin, user.id, athleteId);
    } catch {
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }
    if (!allowed) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    requesterKind = "coach";
  }

  // 4. Entitlement OR trial gate (402 only when neither).
  const access = await resolveGenerationAccess(admin, athleteId);
  if (!access.allowed) {
    logRequest({
      name: "payment_required",
      user_id: user.id,
      athlete_id: athleteId,
      success: false,
      code: "payment_required",
    });
    return NextResponse.json(
      { error: "payment_required", entitlement_key: "ai_plans" },
      { status: 402 }
    );
  }

  // 5. Record the pending attempt (the idempotency anchor + inputs home).
  const requestId = crypto.randomUUID();
  // service-role: explicit user filter required
  const { error: insertErr } = await admin
    .from("ai_generation_attempts")
    .insert({
      athlete_id: athleteId,
      request_id: requestId,
      inputs: input,
      requester_user_id: user.id,
      requester_kind: requesterKind,
      status: "pending",
    });
  if (insertErr) {
    logRequest({
      name: "attempt_insert_failed",
      user_id: user.id,
      athlete_id: athleteId,
      success: false,
      code: "internal",
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  // 6. Best-effort enqueue + 202. The event carries IDS ONLY (no free-text).
  //    An enqueue failure still returns 202: the pending row is harmless and the
  //    caller can re-request (a fresh request_id), but log it.
  try {
    await inngest.send({
      name: PLAN_GENERATE_EVENT,
      data: {
        athlete_id: athleteId,
        request_id: requestId,
        requester_user_id: user.id,
        requester_kind: requesterKind,
      },
    });
  } catch {
    logRequest({
      name: "enqueue_failed",
      user_id: user.id,
      athlete_id: athleteId,
      success: false,
      code: "enqueue_error",
    });
    return NextResponse.json(
      { status: "accepted", request_id: requestId },
      { status: 202 }
    );
  }

  logRequest({
    name: "enqueued",
    user_id: user.id,
    athlete_id: athleteId,
    success: true,
  });
  return NextResponse.json(
    { status: "accepted", request_id: requestId },
    { status: 202 }
  );
}
