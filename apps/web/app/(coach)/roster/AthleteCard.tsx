"use client";

import Link from "next/link";

import type { AthleteEntry } from "@/db/roster";

// Client component: the card has interactive hover styling (onMouseEnter/Leave),
// which cannot live in the server-rendered RosterPage — passing event handlers
// from a Server Component throws "Event handlers cannot be passed to Client
// Component props" at render time. The type-only import of AthleteEntry is
// erased at build time, so this does not pull the server-only @/db/roster
// module into the client bundle.

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

export function AthleteCard({ athlete }: { athlete: AthleteEntry }) {
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
