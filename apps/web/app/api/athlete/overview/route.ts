// GET /api/athlete/overview — the caller's training overview for the mobile
// Home and Reports screens: CTL/ATL/TSB, the 28-day form series, weekly hours
// by sport, per-sport totals, last-28 and the goal event, plus the greeting
// inputs. One source of truth with the web Reports page (getTrainingOverview).

import "server-only";

import { NextResponse } from "next/server";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { getGreeting } from "@/lib/greeting";
import { getTrainingOverview } from "@/training-overview/overview";

export const dynamic = "force-dynamic";

function firstNameOf(displayName: string | null, email: string | null): string | null {
  const nick = displayName?.trim().split(/\s+/)[0];
  if (nick) return nick;
  const local = email?.split("@")[0]?.split(/[._]/)[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const supabase = await createServerClient();
  const { user, error: authErr } = await resolveAuth(supabase, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // service-role: explicit user filter required
  const admin = createAdminClient();
  const now = new Date();
  try {
    const { data: row } = await admin
      .from("users")
      .select("display_name, email, timezone")
      .eq("id", user.id)
      .maybeSingle();
    const timezone = (row?.timezone as string | null) || "UTC";
    const overview = await getTrainingOverview(admin, user.id, timezone, now);

    return NextResponse.json(
      {
        greeting: getGreeting(timezone, now),
        firstName: firstNameOf(
          (row?.display_name as string | null) ?? null,
          (row?.email as string | null) ?? user.email ?? null,
        ),
        timezone,
        overview,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
