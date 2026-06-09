"use client";

import { useState } from "react";
import Link from "next/link";

import type { AthleteEntry } from "@/db/roster";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function daysSince(iso: string | null): number {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  const d = daysSince(iso);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  if (d < 14) return "Over a week ago";
  return `${Math.floor(d / 7)}w ago`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

type Status = "on-track" | "quiet" | "flagged";

function deriveStatus(a: AthleteEntry): Status {
  if (a.weekCount > 0) return "on-track";
  const days = daysSince(a.lastActivityAt);
  if (days <= 7) return "quiet";
  return "flagged";
}

const STATUS_CHIP: Record<Status, { cls: string; label: string; bg: string; color: string }> = {
  "on-track": {
    cls: "ontrack",
    label: "On track",
    bg: "color-mix(in oklab, var(--color-success) 12%, transparent)",
    color: "var(--color-success)",
  },
  quiet: {
    cls: "resting",
    label: "Quiet",
    bg: "var(--color-canvas-soft)",
    color: "var(--color-ink-subtle)",
  },
  flagged: {
    cls: "flagged",
    label: "Needs check-in",
    bg: "color-mix(in oklab, var(--color-danger) 12%, transparent)",
    color: "var(--color-danger)",
  },
};

const FILTERS = [
  { id: "all",     label: "All" },
  { id: "active",  label: "Active" },
  { id: "quiet",   label: "Quiet" },
  { id: "flagged", label: "Needs attention" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

/* ── Component ───────────────────────────────────────────────────────────── */

export function RosterTable({ roster }: { roster: AthleteEntry[] }) {
  const [filter, setFilter] = useState<FilterId>("all");

  const shown = roster.filter((a) => {
    const s = deriveStatus(a);
    if (filter === "active")  return s === "on-track";
    if (filter === "quiet")   return s === "quiet";
    if (filter === "flagged") return s === "flagged";
    return true;
  });

  return (
    <div
      style={{
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {/* Card head */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 24,
          padding: "18px 22px 14px",
          borderBottom: "1px solid var(--color-border)",
          flexWrap: "wrap",
          rowGap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--color-ink-subtle)",
            }}
          >
            Roster · {shown.length} shown
          </div>
          <h2
            style={{
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              margin: "4px 0 0",
              color: "var(--color-ink)",
            }}
          >
            Athletes
          </h2>
        </div>

        {/* Filter chips */}
        <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: "1px solid var(--color-border)",
                background: filter === f.id ? "var(--color-ink)" : "var(--color-paper)",
                color: filter === f.id ? "var(--color-canvas)" : "var(--color-ink-muted)",
                fontSize: 12.5,
                cursor: "pointer",
                transition: "background 120ms, color 120ms, border-color 120ms",
                fontFamily: "inherit",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {shown.length === 0 ? (
        <div
          style={{
            padding: "48px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <p style={{ fontSize: 15, fontWeight: 600, color: "var(--color-ink)", margin: 0 }}>
            No athletes here.
          </p>
          <p style={{ fontSize: 13.5, color: "var(--color-ink-muted)", margin: 0 }}>
            Nobody matches this filter right now.
          </p>
          <button
            onClick={() => setFilter("all")}
            style={{
              marginTop: 8,
              padding: "7px 14px",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "var(--color-paper)",
              fontSize: 13,
              cursor: "pointer",
              color: "var(--color-ink)",
            }}
          >
            Show all
          </button>
        </div>
      ) : (
        <div className="roster-table-wrap">
          {/* Head */}
          <div className="roster-table-head">
            <Th>Athlete</Th>
            <Th>Status</Th>
            <Th>This week</Th>
            <Th className="roster-table-col-last">Last session</Th>
          </div>

          {/* Rows */}
          {shown.map((a) => {
            const status = deriveStatus(a);
            const chip = STATUS_CHIP[status];

            return (
              <Link
                key={a.linkId}
                href={`/athletes/${a.athleteId}`}
                className="roster-table-row"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                {/* Athlete cell */}
                <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: "var(--color-pine)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#fff",
                      flexShrink: 0,
                    }}
                  >
                    {initials(a.displayName)}
                  </span>
                  <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                    <span
                      style={{
                        fontSize: 14,
                        color: "var(--color-ink)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {a.displayName}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        letterSpacing: "0.04em",
                        color: "var(--color-ink-subtle)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {a.email}
                    </span>
                  </div>
                </div>

                {/* Status chip */}
                <div>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 10px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 500,
                      background: chip.bg,
                      color: chip.color,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: chip.color,
                        flexShrink: 0,
                      }}
                    />
                    {chip.label}
                  </span>
                </div>

                {/* Week count */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      width: 46,
                      height: 6,
                      borderRadius: 4,
                      background: "var(--color-canvas-soft)",
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        height: "100%",
                        width: `${Math.min(100, (a.weekCount / 6) * 100)}%`,
                        background:
                          a.weekCount >= 3
                            ? "var(--color-success)"
                            : a.weekCount >= 1
                            ? "var(--color-clay)"
                            : "var(--color-danger)",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color: "var(--color-ink-muted)",
                      fontFeatureSettings: '"tnum"',
                    }}
                  >
                    {a.weekCount} sessions
                  </span>
                </div>

                {/* Last session */}
                <div
                  className="roster-table-col-last"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--color-ink-muted)",
                    fontFeatureSettings: '"tnum"',
                  }}
                >
                  {formatDate(a.lastActivityAt)}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={className}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--color-ink-subtle)",
      }}
    >
      {children}
    </div>
  );
}
