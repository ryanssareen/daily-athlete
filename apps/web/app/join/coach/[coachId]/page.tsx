import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createAdminClient } from "@/db/admin";
import JoinButton from "./JoinButton";

type Props = { params: Promise<{ coachId: string }> };

export default async function JoinCoachPage({ params }: Props) {
  const { coachId } = await params;

  const session = await getUserWithRoles();
  if (!session) {
    const next = encodeURIComponent(`/join/coach/${coachId}`);
    redirect(`/sign-up/athlete?next=${next}`);
  }

  const admin = createAdminClient();

  // Resolve coach display name
  // service-role: explicit user filter required
  const { data: coachRow } = await admin
    .from("users")
    .select("id, display_name, email, role_flags")
    .eq("id", coachId)
    .maybeSingle();

  if (!coachRow || !(coachRow.role_flags as string[]).includes("coach")) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>🔗</p>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Invalid invite link</h1>
          <p style={{ color: "var(--color-ink-muted)", fontSize: 14 }}>
            This link doesn&apos;t match any coach. Ask your coach for a fresh one.
          </p>
        </div>
      </main>
    );
  }

  const coachName = coachRow.display_name ?? coachRow.email ?? "your coach";

  // Check if already linked
  // service-role: explicit user filter required
  const { data: existing } = await admin
    .from("coach_athlete_links")
    .select("coach_user_id")
    .eq("athlete_user_id", session.user.id)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (existing?.coach_user_id === coachId) {
    redirect("/athlete");
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "var(--color-pine)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            margin: "0 auto 20px",
          }}
        >
          🏋️
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 10 }}>
          {coachName} wants to coach you
        </h1>
        <p style={{ color: "var(--color-ink-muted)", fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>
          Joining their roster gives them access to your training data — workouts, plans, and progress.
          You can unlink at any time from Settings.
        </p>
        <JoinButton coachId={coachId} />
        <p style={{ marginTop: 14, fontSize: 12, color: "var(--color-ink-subtle)" }}>
          Signed in as {session.user.email}
        </p>
      </div>
    </main>
  );
}
