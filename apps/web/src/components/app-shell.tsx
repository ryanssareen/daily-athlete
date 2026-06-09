"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { usePathname } from "next/navigation";
import { X } from "lucide-react";

import { AppNav } from "@/components/app-nav";

function Wordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px" }}>
      <span
        style={{
          display: "inline-block",
          width: 28,
          height: 28,
          borderRadius: "50%",
          background:
            "conic-gradient(from 220deg, var(--color-clay) 0deg, var(--color-pine) 180deg, var(--color-clay) 360deg)",
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
      <span
        style={{
          fontWeight: 600,
          fontSize: 15,
          letterSpacing: "-0.02em",
          color: "var(--color-ink)",
        }}
      >
        DA2
      </span>
    </div>
  );
}

interface AppShellProps {
  role: "athlete" | "coach";
  email: string;
  theme: string;
  children: ReactNode;
}

/**
 * Responsive shell shared by the athlete and coach areas.
 *
 * Desktop (≥769px) renders the original sticky 220px sidebar. Mobile (≤768px)
 * hides it and shows a sticky top bar whose hamburger opens a slide-over drawer
 * that reuses the same <AppNav> — so navigation, theme toggle, and sign out all
 * stay reachable on phones. Breakpoint + layout live in globals.css (.app-*).
 */
export function AppShell({ role, email, theme, children }: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer on navigation (e.g. tapping a nav link).
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // While the drawer is open, lock body scroll and allow Escape to dismiss.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [navOpen]);

  return (
    <div className="app-shell">
      {/* Desktop sidebar */}
      <aside className="app-sidebar">
        <div className="app-shell-head">
          <Wordmark />
        </div>
        <div style={{ flex: 1 }}>
          <AppNav role={role} email={email} theme={theme} />
        </div>
      </aside>

      {/* Content column: mobile top bar + main */}
      <div className="app-content">
        <header className="app-topbar">
          <button
            type="button"
            className="app-burger"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            aria-controls="app-mobile-nav"
            onClick={() => setNavOpen(true)}
          >
            <span />
            <span />
            <span />
          </button>
          <Wordmark />
        </header>
        <main className="app-main">{children}</main>
      </div>

      {/* Mobile slide-over drawer (CSS hides it on desktop) */}
      {navOpen && (
        <div className="app-drawer" id="app-mobile-nav">
          <div
            className="app-drawer-scrim"
            onClick={() => setNavOpen(false)}
            aria-hidden="true"
          />
          <div
            className="app-drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="app-shell-head app-drawer-head">
              <Wordmark />
              <button
                type="button"
                className="app-drawer-close"
                aria-label="Close navigation"
                onClick={() => setNavOpen(false)}
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
            <div style={{ flex: 1 }}>
              <AppNav role={role} email={email} theme={theme} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
