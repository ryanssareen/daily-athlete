// GET /api/plans/[id] — a single plan's detail (plan Unit 3).
// DELETE /api/plans/[id] — soft-delete a plan (plan Unit 5).
//
// Ownership mismatch and not-found both return 404 -- never 403 -- so a
// request for another athlete's plan can't distinguish "doesn't exist" from
// "exists but isn't yours" (matches the not_found_or_forbidden convention
// already used by the MCP tool surface in @/mcp/tools).

import { NextResponse } from "next/server";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { getPlan, softDeletePlan } from "@/db/plans";

export const dynamic = "force-dynamic";

export async function GET(
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
  let plan;
  try {
    plan = await getPlan(admin, user.id, planId);
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  if (!plan) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ plan }, { status: 200 });
}

export async function DELETE(
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
    result = await softDeletePlan(admin, user.id, planId);
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  if (!result.ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
