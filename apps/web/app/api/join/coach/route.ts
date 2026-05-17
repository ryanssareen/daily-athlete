import { NextResponse } from "next/server";

import { getUserWithRoles } from "@/auth/roles";
import { createAdminClient } from "@/db/admin";

export async function POST(req: Request) {
  const session = await getUserWithRoles();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let coachId: string;
  try {
    const body = await req.json();
    coachId = body.coachId;
    if (!coachId || typeof coachId !== "string") throw new Error("missing coachId");
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (session.user.id === coachId) {
    return NextResponse.json({ error: "You cannot join your own roster" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify the coach exists and has the coach role
  // service-role: explicit user filter required
  const { data: coachRow } = await admin
    .from("users")
    .select("id, role_flags")
    .eq("id", coachId)
    .maybeSingle();

  if (!coachRow) {
    return NextResponse.json({ error: "Coach not found" }, { status: 404 });
  }
  const roles = (coachRow.role_flags ?? ["athlete"]) as string[];
  if (!roles.includes("coach")) {
    return NextResponse.json({ error: "Invalid invite link" }, { status: 400 });
  }

  // Check for existing active link
  // service-role: explicit user filter required
  const { data: existing } = await admin
    .from("coach_athlete_links")
    .select("id, coach_user_id")
    .eq("athlete_user_id", session.user.id)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) {
    if (existing.coach_user_id === coachId) {
      return NextResponse.json({ ok: true, alreadyLinked: true });
    }
    return NextResponse.json(
      { error: "You are already linked to a different coach. Contact support to switch." },
      { status: 409 }
    );
  }

  // service-role: explicit user filter required
  const { error } = await admin.from("coach_athlete_links").insert({
    coach_user_id: coachId,
    athlete_user_id: session.user.id,
    status: "active",
    invited_at: new Date().toISOString(),
    accepted_at: new Date().toISOString(),
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, alreadyLinked: true });
    }
    console.error("[join-coach] insert failed", error.message);
    return NextResponse.json({ error: "Failed to join roster" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
