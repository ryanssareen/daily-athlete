// POST /api/weekly-review/[id]/accept
//
// Body: { op_ids: string[] }  — the subset of the proposal's op-ids the
// recipient accepts (the "modify" subset; deselected ops never apply). The
// endpoint accepts ONLY op-ids, never op bodies — `proposed_changes` from the
// row is the sole op source (status is RPC-only; clients cannot inject ops).
//
// Flow (plan Unit 6):
//   1. resolveAuth() (Bearer or cookie).
//   2. Verify the caller is the proposal's RECIPIENT (athlete for
//      recipient='athlete'; an active linked coach for recipient='coach').
//   3. requireEntitlement('ai_plans') — lapsed → 402, proposal left readable.
//   4. Already-decided (status != 'proposed') → 409.
//   5. reValidateAndApply() — re-validate invariants against CURRENT load in
//      Node, then atomically apply via the apply_weekly_review RPC.
//
// Returns the apply result { status, superseded, results }. A coupled proposal
// whose re-validation drops any op returns status='superseded' (re-enqueueable).

import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { requireEntitlement } from "@/auth/entitlements";
import { authorizeRecipient } from "@/ai/adaptive/recipient-auth";
import { reValidateAndApply } from "@/ai/adaptive/apply";

const AcceptBodySchema = z.object({
  op_ids: z.array(z.string().min(1)),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: reviewId } = await params;

  // 1. Authenticate.
  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Parse body — op-ids only.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_input", message: "request body was not valid JSON" },
      { status: 400 }
    );
  }
  const parsed = AcceptBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", message: parsed.error.message },
      { status: 400 }
    );
  }
  const opIds = parsed.data.op_ids;

  // 3. Recipient authorization.
  const admin = createAdminClient();
  let auth;
  try {
    auth = await authorizeRecipient(admin, reviewId, user.id);
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  if (auth.kind === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (auth.kind === "forbidden") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const review = auth.review;

  // 4. Entitlement re-check at apply (may have lapsed while pending). Lapsed →
  //    402; the proposal stays readable. Check against the ATHLETE who owns the
  //    proposal (the paid feature belongs to the athlete, not the coach).
  const gate = await requireEntitlement(admin, review.athlete_id, "ai_plans");
  if (gate) return gate;

  // 5. Already-decided guard — only a `proposed` proposal can be accepted.
  if (review.status !== "proposed") {
    return NextResponse.json(
      { error: "already_decided", status: review.status },
      { status: 409 }
    );
  }

  // 6. Re-validate against current load + apply atomically.
  let result;
  try {
    result = await reValidateAndApply(review, opIds, user.id, { admin });
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  // The RPC reports already_decided when a concurrent decision won the race —
  // surface as 409 so the agent/UI re-reads the now-terminal proposal.
  if (result.already_decided) {
    return NextResponse.json(
      { error: "already_decided", status: result.status },
      { status: 409 }
    );
  }

  return NextResponse.json(
    {
      status: result.status,
      superseded: result.superseded,
      results: result.results,
    },
    { status: 200 }
  );
}
