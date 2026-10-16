// GET /api/plans/[id]/view -- the Plan tab's story, week outline, results and
// forecast for one plan. Shared by the web page (which calls buildPlanView
// directly) and the Flutter app (bearer only). Auth via resolveAuth, data via
// the admin client with explicit athlete filters inside buildPlanView: a
// bearer request has no cookies, so an RLS-bound client would query as anon.

import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { getPlan } from "@/db/plans";
import { buildPlanView, PlanViewNotFoundError } from "@/plan/plan-view";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

const PlanIdSchema = z.string().uuid();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: rawId } = await params;
  const parsedId = PlanIdSchema.safeParse(rawId);

  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!parsedId.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }

  const admin = createAdminClient();
  try {
    const plan = await getPlan(admin, user.id, parsedId.data);
    if (!plan) {
      return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    }

    // service-role: explicit user filter required
    const { data: profile } = await admin
      .from("users")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle();
    const timezone = (profile?.timezone as string | null) ?? "UTC";

    const view = await buildPlanView(admin, user.id, plan, timezone, new Date());
    return NextResponse.json({ view }, { status: 200, headers: NO_STORE });
  } catch (err) {
    if (err instanceof PlanViewNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ error: "internal" }, { status: 500, headers: NO_STORE });
  }
}
