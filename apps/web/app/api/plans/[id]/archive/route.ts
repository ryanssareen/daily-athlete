// PATCH /api/plans/[id]/archive — archive a plan the caller owns (plan Unit 4).
//
// Control-flow shape mirrors @/api/coach/links/[id]/archive, but deliberately
// does NOT reuse its 403-on-ownership-mismatch branch: ownership mismatch
// here folds into the same 404 as not-found (see @/db/plans getPlan/
// archivePlan doc comments and R6 in the plan doc) so a request for another
// athlete's plan can't distinguish "doesn't exist" from "exists but isn't
// yours".

import { NextResponse } from "next/server";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { archivePlan } from "@/db/plans";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: planId } = await params;

  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  let result;
  try {
    result = await archivePlan(admin, user.id, planId);
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  if (!result.ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ plan: result.plan }, { status: 200 });
}
