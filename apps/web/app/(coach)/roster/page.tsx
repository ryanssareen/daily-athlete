import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createAdminClient } from "@/db/admin";
import { getCoachRoster } from "@/db/roster";
import InviteSection from "./InviteSection";
import { AthleteCard } from "./AthleteCard";

// ---------- Sub-components ------------------------------------------------

function StatTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 16,
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <p className="eyebrow">{label}</p>
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 30,
          fontWeight: 600,
          color: accent ?? "var(--color-ink)",
          letterSpacing: "-0.02em",
          lineHeight: 1,
        }}
      >
        {value}
      </p>
    </div>
  );
}

// ---------- Page ----------------------------------------------------------

export default async function RosterPage() {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const admin = createAdminClient();
  const roster = await getCoachRoster(admin, session.user.id);

  const total = roster.length;
  const activeThisWeek = roster.filter((a) => a.weekCount > 0).length;
  const sessionsThisWeek = roster.reduce((sum, a) => sum + a.weekCount, 0);
  const isEmpty = total === 0;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      {/* Header */}
      <header style={{ marginBottom: 28 }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>
          Roster
        </p>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "var(--color-ink)",
            margin: 0,
          }}
        >
          Your athletes
        </h1>
        <p style={{ color: "var(--color-ink-muted)", marginTop: 6, fontSize: 15 }}>
          {isEmpty
            ? "Invite your first athlete to start coaching."
            : `Coaching ${total} ${total === 1 ? "athlete" : "athletes"} — ${activeThisWeek} active this week.`}
        </p>
      </header>

      {isEmpty ? (
        /* Empty state */
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              background: "var(--color-paper)",
              border: "1px solid var(--color-border)",
              borderRadius: 16,
              padding: "48px 40px",
              textAlign: "center",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 48,
                height: 48,
                borderRadius: "50%",
                background:
                  "conic-gradient(from 220deg, var(--color-clay) 0deg, var(--color-pine) 180deg, var(--color-clay) 360deg)",
                marginBottom: 18,
              }}
            />
            <p style={{ fontSize: 17, fontWeight: 600, color: "var(--color-ink)", margin: "0 0 8px" }}>
              No athletes linked yet
            </p>
            <p
              style={{
                fontSize: 14,
                color: "var(--color-ink-muted)",
                maxWidth: 420,
                margin: "0 auto",
                lineHeight: 1.55,
              }}
            >
              Once an athlete opens your link and signs in, they&apos;ll appear here with their
              training at a glance.
            </p>
          </div>
          <InviteSection coachId={session.user.id} variant="primary" />
        </div>
      ) : (
        <>
          {/* Summary */}
          <section style={{ marginBottom: 28 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 12,
              }}
            >
              <StatTile label="Athletes" value={String(total)} />
              <StatTile
                label="Active this week"
                value={String(activeThisWeek)}
                accent={activeThisWeek > 0 ? "var(--color-success)" : undefined}
              />
              <StatTile label="Sessions this week" value={String(sessionsThisWeek)} />
            </div>
          </section>

          {/* Athlete grid */}
          <section style={{ marginBottom: 28 }}>
            <p className="eyebrow" style={{ marginBottom: 14 }}>
              Athletes
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 16,
              }}
            >
              {roster.map((athlete, i) => (
                <AthleteCard key={athlete.linkId} athlete={athlete} index={i} />
              ))}
            </div>
          </section>

          {/* Invite (secondary) */}
          <InviteSection coachId={session.user.id} variant="secondary" />
        </>
      )}
    </div>
  );
}
