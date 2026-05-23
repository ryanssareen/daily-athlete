// Admin landing (/admin). Routes the operator into each section so the
// dashboard is a navigable whole, not a set of disconnected URLs. Tiles are
// navigational only — no fabricated metrics; live counts/health live on each
// section's own page.

import Link from "next/link";

const SECTIONS = [
  {
    href: "/admin/backups",
    name: "Backups",
    desc: "Managed-backup status, on-demand encrypted exports, and the restore runbook.",
    meta: ["Managed + on-demand", "Encrypted"] as const,
  },
  {
    href: "/admin/users",
    name: "Users",
    desc: "Read-only directory of users by name and email, with search.",
    meta: ["Name + email", "Read-only"] as const,
  },
  {
    href: "/admin/logs",
    name: "Logs",
    desc: "Append-only audit trail of every admin operation, filterable by area.",
    meta: ["Audit trail", "Read-only"] as const,
  },
  {
    href: "/admin/api-playground",
    name: "API Playground",
    desc: "Invoke allow-listed, non-destructive endpoints as the operator.",
    meta: ["Allow-listed", "Audited"] as const,
  },
] as const;

export default function AdminOverviewPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header className="page-header">
        <div className="page-header-body">
          <div className="page-eyebrow">Operator console</div>
          <h1 className="page-title">Overview</h1>
          <p className="page-desc">
            Operational tooling for Daily Athlete — backups, exports, and the
            user directory.
          </p>
        </div>
      </header>

      <div className="overview-grid">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="overview-tile">
            <div className="overview-tile-head">
              <span className="overview-tile-name">{s.name}</span>
            </div>
            <span className="overview-tile-desc">{s.desc}</span>
            <div className="overview-tile-meta">
              <span>{s.meta[0]}</span>
              <span>{s.meta[1]}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
