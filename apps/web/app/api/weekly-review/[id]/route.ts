// GET /api/weekly-review/[id]
//
// Returns one AI adaptive proposal, recipient-authorized (plan Unit 6):
//   - recipient='athlete' : the athlete (athlete_id) only.
//   - recipient='coach'   : an actively-linked coach only.
//
// Auth surface: Bearer token (Flutter) or cookie session (browser), resolved
// through resolveAuth() like the status route. Agent-native named resource.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { authorizeRecipient } from "@/ai/adaptive/recipient-auth";

export async function GET(
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

  // 2. Fetch + recipient-authorize.
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

  return NextResponse.json({ proposal: auth.review }, { status: 200 });
}
