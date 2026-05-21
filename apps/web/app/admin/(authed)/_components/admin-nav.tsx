"use client";

// Persistent admin nav + logout. Underscore-prefixed folder => not a route.
// Logout POSTs to /api/admin/logout (same-origin, satisfies the CSRF guard),
// then sends the operator back to the login page.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/backups", label: "Backups" },
  { href: "/admin/users", label: "Users" },
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
    <nav
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: 12,
        height: "100%",
      }}
    >
      {LINKS.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            style={{
              padding: "9px 12px",
              borderRadius: 8,
              fontSize: 14,
              textDecoration: "none",
              color: active ? "white" : "var(--color-ink)",
              background: active ? "var(--color-clay)" : "transparent",
              fontWeight: active ? 600 : 500,
            }}
          >
            {link.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={logout}
        style={{
          marginTop: "auto",
          padding: "9px 12px",
          borderRadius: 8,
          border: "1px solid var(--color-border-strong)",
          background: "transparent",
          color: "var(--color-ink-muted)",
          fontSize: 14,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        Log out
      </button>
    </nav>
  );
}
