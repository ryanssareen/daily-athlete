import Link from "next/link";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createAdminClient } from "@/db/admin";
import { getCoachRoster, type AthleteEntry } from "@/db/roster";

// ---------- Helpers -------------------------------------------------------

function formatLastActive(iso: string | null): string {
  if (!iso) return "No activity yet";
  const then = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Active today";
  if (diffDays === 1) return "Active yesterday";
  return `Last active ${diffDays} days ago`;
}

// ---------- Sub-components ------------------------------------------------

function AthleteCard({ athlete }: { athlete: AthleteEntry }) {
  const initials = athlete.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Link
      href={`/athletes/${athlete.athleteId}`}
      style={{
        display: "block",
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 16,
        padding: "20px 24px",
        textDecoration: "none",
        transition: "border-color 120ms ease, box-shadow 120ms ease",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.borderColor = "var(--color-border-strong)";
        el.style.boxShadow = "0 2px 8px color-mix(in oklab, var(--color-ink) 6%, transparent)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.borderColor = "var(--color-border)";
        el.style.boxShadow = "none";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "var(--color-pine)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              fontWeight: 600,
              fontSize: 15,
              color: "var(--color-ink)",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {athlete.displayName}
          </p>
          <p
            style={{
              fontSize: 12,
              color: "var(--color-ink-muted)",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {athlete.email}
          </p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", margin: 0 }}>
            Last activity
          </p>
          <p style={{ fontSize: 12, color: "var(--color-ink-muted)", margin: 0, fontWeight: 500 }}>
            {formatLastActive(athlete.lastActivityAt)}
          </p>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", margin: 0 }}>
            This week
          </p>
          <p style={{ fontSize: 12, color: "var(--color-ink-muted)", margin: 0, fontWeight: 500 }}>
            {athlete.weekCount} {athlete.weekCount === 1 ? "workout" : "workouts"}
          </p>
        </div>
      </div>
    </Link>
  );
}

// ---------- Page ----------------------------------------------------------

export default async function RosterPage() {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const admin = createAdminClient();
  const roster = await getCoachRoster(admin, session.user.id);

  return (
    <div style={{ maxWidth: 900 }}>
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
