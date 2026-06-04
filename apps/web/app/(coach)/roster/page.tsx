import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createAdminClient } from "@/db/admin";
import { getCoachRoster } from "@/db/roster";
import InviteSection from "./InviteSection";
import { AthleteCard } from "./AthleteCard";

// ---------- Page ----------------------------------------------------------

export default async function RosterPage() {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const admin = createAdminClient();
  const roster = await getCoachRoster(admin, session.user.id);

  return (
    <div style={{ maxWidth: 900 }}>
      <InviteSection coachId={session.user.id} />

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "var(--color-ink)",
            margin: 0,
          }}
        >
          Your Roster
        </h1>
        <p style={{ color: "var(--color-ink-muted)", marginTop: 6, fontSize: 15 }}>
          {roster.length} {roster.length === 1 ? "athlete" : "athletes"} linked.
        </p>
      </div>

      {roster.length === 0 ? (
        /* Empty state */
        <div
          style={{
            background: "var(--color-paper)",
            border: "1px solid var(--color-border)",
            borderRadius: 16,
            padding: "56px 40px",
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: 32,
              marginBottom: 12,
              lineHeight: 1,
            }}
          >
            🏋️
          </p>
          <p
            style={{
              fontSize: 16,
              fontWeight: 500,
              color: "var(--color-ink)",
              marginBottom: 8,
            }}
          >
            No athletes linked yet
          </p>
          <p
            style={{
              fontSize: 14,
              color: "var(--color-ink-muted)",
              maxWidth: 420,
              margin: "0 auto",
            }}
          >
            Share your coach link with athletes to get started. Once they accept, you&apos;ll see their training here.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {roster.map((athlete) => (
            <AthleteCard key={athlete.linkId} athlete={athlete} />
          ))}
        </div>
      )}
    </div>
  );
}
