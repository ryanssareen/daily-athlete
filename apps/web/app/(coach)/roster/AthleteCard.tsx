"use client";

import { useState } from "react";
import Link from "next/link";

import type { AthleteEntry } from "@/db/roster";

// Client component: the card has interactive hover styling, which cannot live
// in the server-rendered RosterPage — passing event handlers from a Server
// Component throws "Event handlers cannot be passed to Client Component props"
// at render time. The type-only import of AthleteEntry is erased at build
// time, so this does not pull the server-only @/db/roster module into the
// client bundle.

function formatLastActive(iso: string | null): string {
  if (!iso) return "No activity logged";
  const then = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "Active today";
  if (diffDays === 1) return "Active yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return "Over a week ago";
  if (diffDays < 31) return `${Math.floor(diffDays / 7)} weeks ago`;
  return "Over a month ago";
}

/** Qualitative training status, used for the status dot + label. */
function activityStatus(
  weekCount: number,
  lastActivityAt: string | null,
): { color: string; label: string } {
  if (weekCount > 0) return { color: "var(--color-success)", label: "Active this week" };
  if (!lastActivityAt) return { color: "var(--color-border-strong)", label: "Not started yet" };
  const days = Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 21) return { color: "var(--color-ink-subtle)", label: "Quiet this week" };
  return { color: "var(--color-clay)", label: "Dormant" };
}

export function AthleteCard({ athlete, index = 0 }: { athlete: AthleteEntry; index?: number }) {
  const [hovered, setHovered] = useState(false);

  const initials = athlete.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const status = activityStatus(athlete.weekCount, athlete.lastActivityAt);

  return (
    <Link
      href={`/athletes/${athlete.athleteId}`}
      className="da-enter"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--color-paper)",
        border: `1px solid ${hovered ? "var(--color-border-strong)" : "var(--color-border)"}`,
        borderRadius: 16,
        padding: "20px 22px",
        textDecoration: "none",
        boxShadow: hovered
          ? "0 6px 20px color-mix(in oklab, var(--color-ink) 9%, transparent)"
          : "0 1px 2px color-mix(in oklab, var(--color-ink) 4%, transparent)",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        transition: "border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease",
        // Stagger the entrance; capped so large rosters don't wait long.
        animationDelay: `${Math.min(index, 12) * 45}ms`,
      }}
    >
      {/* Identity row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "var(--color-pine)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
            flexShrink: 0,
            boxShadow: "inset 0 0 0 1px color-mix(in oklab, #fff 18%, transparent)",
          }}
        >
          {initials}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p
            style={{
              fontWeight: 600,
              fontSize: 15.5,
              color: "var(--color-ink)",
              margin: 0,
              letterSpacing: "-0.01em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {athlete.displayName}
          </p>
          <p
            style={{
              fontSize: 12.5,
              color: "var(--color-ink-muted)",
              margin: "1px 0 0",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {athlete.email}
          </p>
        </div>
        {/* Navigation affordance */}
        <span
          aria-hidden="true"
          style={{
            flexShrink: 0,
            fontSize: 18,
            lineHeight: 1,
            color: hovered ? "var(--color-clay)" : "var(--color-ink-subtle)",
            transform: hovered ? "translateX(2px)" : "translateX(0)",
            transition: "color 140ms ease, transform 140ms ease",
          }}
        >
          ›
        </span>
      </div>

      {/* Divider */}
      <div
        style={{
          height: 1,
          background: "var(--color-border)",
          margin: "16px 0 14px",
        }}
      />

      {/* Footer: status (left) + this-week count (right) */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: status.color,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-ink)" }}>
              {status.label}
            </span>
          </div>
          <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", margin: "4px 0 0" }}>
            {formatLastActive(athlete.lastActivityAt)}
          </p>
        </div>

        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 22,
              fontWeight: 600,
              lineHeight: 1,
              color: athlete.weekCount > 0 ? "var(--color-ink)" : "var(--color-ink-subtle)",
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            {athlete.weekCount}
          </p>
          <p className="eyebrow" style={{ margin: "5px 0 0", fontSize: 10 }}>
            This week
          </p>
        </div>
      </div>
    </Link>
  );
}
