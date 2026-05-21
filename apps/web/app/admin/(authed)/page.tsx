// Admin landing (/admin). Routes the operator into each section so the
// dashboard is a navigable whole, not a set of disconnected URLs.

import Link from "next/link";

const SECTIONS = [
  {
    href: "/admin/backups",
    title: "Backups",
    body: "Managed-backup status, on-demand encrypted exports, and the restore runbook.",
  },
  {
    href: "/admin/users",
    title: "Users",
    body: "Read-only directory of users by name and email, with search.",
  },
] as const;

export default function AdminOverviewPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ margin: 0, fontSize: 22, color: "var(--color-ink)" }}>
        Overview
      </h1>
      <p style={{ margin: "8px 0 24px", color: "var(--color-ink-muted)" }}>
        Operational tooling for Daily Athlete.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
        }}
      >
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            style={{
              display: "block",
              padding: 20,
              borderRadius: 12,
              border: "1px solid var(--color-border)",
              background: "var(--color-paper)",
              textDecoration: "none",
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--color-ink)",
              }}
            >
              {s.title}
            </div>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 13,
                color: "var(--color-ink-muted)",
              }}
            >
              {s.body}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
