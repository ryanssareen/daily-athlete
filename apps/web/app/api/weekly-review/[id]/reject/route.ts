// POST /api/weekly-review/[id]/reject
//
// Rejects an AI adaptive proposal (plan Unit 6). No body. Flow:
//   1. resolveAuth() (Bearer or cookie).
//   2. Verify the caller is the proposal's RECIPIENT (athlete or active linked
//      coach, per the recipient-routing decision).
//   3. reject_weekly_review RPC — a single status transition kept as an RPC so
//      weekly_reviews.status is only ever written by SECURITY DEFINER functions.
//
// reject_weekly_review only transitions a `proposed` row → `rejected`. An
// already-decided proposal is reported as { changed: false } → 409.
//
// No entitlement gate on reject: a lapsed user must always be able to dismiss a
// pending proposal (it is the apply path that is paid-gated).

import { NextResponse } from "next/server";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { authorizeRecipient } from "@/ai/adaptive/recipient-auth";

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

  // 2. Recipient authorization.
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

  // 3. Reject via the RPC (the sole writer of status).
  const { data, error } = await admin.rpc("reject_weekly_review", {
    p_review_id: reviewId,
  });

  if (error) {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  const rpcResult = (data ?? {}) as { status?: string; changed?: boolean };

  // Already-decided (no transition happened) → 409.
  if (rpcResult.changed === false) {
    return NextResponse.json(
      { error: "already_decided", status: rpcResult.status ?? "unknown" },
      { status: 409 }
    );
  }

  return NextResponse.json(
    { status: rpcResult.status ?? "rejected", changed: true },
    { status: 200 }
  );
}
