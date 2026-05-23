"use client";

// Persistent admin sidebar: brand mark, section nav, and logout. Renders the
// whole left rail (the layout just slots it into .admin-shell). Underscore-
// prefixed folder => not a route. Logout POSTs to /api/admin/logout
// (same-origin, satisfies the CSRF guard), then returns the operator to login.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/backups", label: "Backups" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/logs", label: "Logs" },
  { href: "/admin/api-playground", label: "API Playground" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname() ?? "";
  const router = useRouter();

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <aside className="admin-nav">
      <div className="nav-brand">
        <span className="nav-brand-mark" />
        <span className="nav-brand-text">
          <span className="nav-brand-name">Daily Athlete</span>
          <span className="nav-brand-tag">DA2 · Admin</span>
        </span>
      </div>

      <div className="nav-section">
        <div className="nav-section-label">Console</div>
        <div className="nav-list">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={"nav-item" + (isActive(pathname, link.href) ? " is-active" : "")}
            >
              <span>{link.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="nav-foot">
        <div className="nav-foot-meta">
          <span className="k">Signed in</span>
          <span className="v">Operator</span>
        </div>
        <button type="button" className="nav-foot-btn" onClick={logout}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
