// GET /api/integrations/strava/totals — the signed-in athlete's Strava
// recent / year-to-date / all-time totals, fetched live and not stored.
// Auth: cookie or Bearer via resolveAuth (web and mobile share this route).

import "server-only";

import { NextResponse } from "next/server";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { loadStravaTotals } from "@/strava/load-totals";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: HEADERS });
  }

  const result = await loadStravaTotals({ admin: createAdminClient(), userId: user.id });
  switch (result.status) {
    case "ok":
      return NextResponse.json({ status: "ok", sports: result.sports }, { headers: HEADERS });
    case "rate_limited":
      return NextResponse.json({ status: "rate_limited" }, { status: 429, headers: HEADERS });
    case "reauth_required":
      return NextResponse.json({ status: "reauth_required" }, { status: 401, headers: HEADERS });
    case "error":
      return NextResponse.json({ status: "error" }, { status: 502, headers: HEADERS });
    default:
      return NextResponse.json({ status: "unavailable" }, { headers: HEADERS });
  }
}
