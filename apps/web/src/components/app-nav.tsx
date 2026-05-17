"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import {
  LayoutDashboard,
  Activity,
  CalendarDays,
  Settings,
  Users,
  Sun,
  Moon,
} from "lucide-react";

interface NavItem {
  href: Route;
  label: string;
  icon: React.ElementType;
}

const athleteNav: NavItem[] = [
  { href: "/athlete" as Route, label: "Dashboard", icon: LayoutDashboard },
  { href: "/athlete/activities" as Route, label: "Activities", icon: Activity },
  { href: "/athlete/calendar" as Route, label: "Calendar", icon: CalendarDays },
  { href: "/athlete/settings" as Route, label: "Settings", icon: Settings },
];

const coachNav: NavItem[] = [
  { href: "/roster" as Route, label: "Roster", icon: Users },
  { href: "/settings" as Route, label: "Settings", icon: Settings },
];

interface AppNavProps {
  role: "athlete" | "coach";
  email: string;
  theme: string;
}

export function AppNav({ role, email, theme }: AppNavProps) {
  const pathname = usePathname();
  const navItems = role === "athlete" ? athleteNav : coachNav;
  const nextTheme = theme === "dark" ? "light" : "dark";

  function isActive(href: Route): boolean {
    const hrefStr = href as string;
    if (hrefStr === "/athlete") {
      return pathname === "/athlete";
    }
    return pathname.startsWith(hrefStr);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "24px 16px",
        gap: 4,
      }}
    >
      {/* Nav items */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: active ? 500 : 400,
                textDecoration: "none",
                transition: "background 120ms ease, color 120ms ease",
                background: active ? "var(--color-clay-soft)" : "transparent",
                color: active ? "var(--color-clay-deep)" : "var(--color-ink-muted)",
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLAnchorElement).style.color = "var(--color-ink)";
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLAnchorElement).style.color = "var(--color-ink-muted)";
                }
              }}
            >
              <Icon size={16} strokeWidth={active ? 2.25 : 1.75} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          paddingTop: 12,
          borderTop: "1px solid var(--color-border)",
        }}
      >
        {/* Email */}
        <p
          style={{
            fontSize: 12,
            color: "var(--color-ink-subtle)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            padding: "0 4px",
          }}
          title={email}
        >
          {email}
        </p>

        {/* Theme toggle */}
        <form action="/api/theme" method="post">
          <input type="hidden" name="theme" value={nextTheme} />
          <button
            type="submit"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 12px",
              borderRadius: 10,
              fontSize: 13,
              color: "var(--color-ink-muted)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              transition: "color 120ms ease",
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-ink)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-ink-muted)";
            }}
          >
            {theme === "dark" ? <Sun size={14} strokeWidth={1.75} /> : <Moon size={14} strokeWidth={1.75} />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </form>

        {/* Sign out */}
        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 12px",
              borderRadius: 10,
              fontSize: 13,
              color: "var(--color-ink-muted)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              transition: "color 120ms ease",
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-ink)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-ink-muted)";
            }}
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
