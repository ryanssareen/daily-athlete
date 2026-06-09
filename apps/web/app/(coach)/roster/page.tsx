import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createAdminClient } from "@/db/admin";
import { getCoachRoster } from "@/db/roster";
import type { AthleteEntry } from "@/db/roster";
import InviteSection from "./InviteSection";
import { RosterTable } from "./RosterTable";

/* ── Data helpers ────────────────────────────────────────────────────────── */

function daysSince(iso: string | null): number {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function needsAttention(a: AthleteEntry): boolean {
  if (a.weekCount === 0 && a.lastActivityAt === null) return true;
  if (a.weekCount === 0 && daysSince(a.lastActivityAt) > 14) return true;
  return false;
}

/* ── Sub-components ──────────────────────────────────────────────────────── */

function BdCell({
  value,
  label,
  accent,
}: {
  value: string | number;
  label: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        background: "var(--color-paper)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: accent ?? "var(--color-ink)",
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>{label}</span>
    </div>
  );
}

function AttentionList({ athletes }: { athletes: AthleteEntry[] }) {
  if (athletes.length === 0) return null;

  function reason(a: AthleteEntry): string {
    if (!a.lastActivityAt) return "No sessions recorded yet";
    const d = daysSince(a.lastActivityAt);
    return `No activity for ${d} days`;
  }

  function detail(a: AthleteEntry): string {
    if (!a.lastActivityAt) return "Has not started training";
    const d = daysSince(a.lastActivityAt);
    if (d > 30) return `Last session over a month ago`;
    return `Last seen ${d} days ago · 0 sessions this week`;
  }

  function initials(name: string): string {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase();
  }

  return (
    <div
      style={{
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "18px 22px 14px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
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
          Needs attention
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
          {athletes.length} {athletes.length === 1 ? "athlete" : "athletes"} to check on
        </h2>
      </div>

      {athletes.map((a) => (
        <div
          key={a.linkId}
          style={{
            display: "grid",
            gridTemplateColumns: "34px 1fr auto",
            gap: 14,
            alignItems: "center",
            padding: "14px 22px",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: "var(--color-clay)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
              color: "#fff",
              flexShrink: 0,
            }}
          >
            {initials(a.displayName)}
          </span>

          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--color-ink)" }}>
              {a.displayName}
            </span>
            <span style={{ fontSize: 13, color: "var(--color-ink)" }}>{reason(a)}</span>
            <span
              style={{
                fontSize: 12,
                color: "var(--color-ink-subtle)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.02em",
              }}
            >
              {detail(a)}
            </span>
          </div>

          <a
            href={`/athletes/${a.athleteId}`}
            style={{
              padding: "7px 13px",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "var(--color-paper)",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--color-ink)",
              textDecoration: "none",
              flexShrink: 0,
              transition: "border-color 120ms, background 120ms",
            }}
          >
            Review
          </a>
        </div>
      ))}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default async function RosterPage() {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const admin = createAdminClient();
  const roster = await getCoachRoster(admin, session.user.id);

  const total = roster.length;
  const activeThisWeek = roster.filter((a) => a.weekCount > 0).length;
  const restingThisWeek = roster.filter((a) => a.weekCount === 0 && a.lastActivityAt && daysSince(a.lastActivityAt) <= 7).length;
  const attentionList = roster.filter(needsAttention);
  const isEmpty = total === 0;

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Page header */}
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 32,
          paddingBottom: 4,
          flexWrap: "wrap",
          rowGap: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
            Coach
          </div>
          <h1
            style={{
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: 0,
              color: "var(--color-ink)",
            }}
          >
            Roster
          </h1>
          <p style={{ fontSize: 14, color: "var(--color-ink-muted)", maxWidth: "60ch", margin: 0 }}>
            {today} · {isEmpty
              ? "Invite your first athlete to start coaching."
              : `${activeThisWeek} of ${total} ${total === 1 ? "athlete" : "athletes"} active this week.`}
          </p>
        </div>

        {!isEmpty && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <InviteSection coachId={session.user.id} variant="secondary" />
          </div>
        )}
      </header>

      {isEmpty ? (
        /* ── Empty state ─────────────────────────────────────────────────── */
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              background: "var(--color-paper)",
              border: "1px solid var(--color-border)",
              borderRadius: 16,
              padding: "48px 40px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 48,
                height: 48,
                borderRadius: "50%",
                background:
                  "conic-gradient(from 220deg, var(--color-clay) 0deg, var(--color-pine) 180deg, var(--color-clay) 360deg)",
              }}
            />
            <p style={{ fontSize: 17, fontWeight: 600, color: "var(--color-ink)", margin: 0 }}>
              No athletes linked yet
            </p>
            <p
              style={{
                fontSize: 14,
                color: "var(--color-ink-muted)",
                maxWidth: 420,
                margin: 0,
                lineHeight: 1.55,
              }}
            >
              Once an athlete opens your link and signs in, they&apos;ll appear here with
              their training at a glance.
            </p>
          </div>
          <InviteSection coachId={session.user.id} variant="primary" />
        </div>
      ) : (
        <>
          {/* ── Summary band ─────────────────────────────────────────────── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 1,
              background: "var(--color-border)",
              border: "1px solid var(--color-border)",
              borderRadius: 14,
              overflow: "hidden",
            }}
            className="summary-band"
          >
            <BdCell value={total}            label="Total athletes" />
            <BdCell value={activeThisWeek}   label="Active this week"    accent={activeThisWeek > 0 ? "var(--color-pine)" : undefined} />
            <BdCell value={restingThisWeek}  label="Quiet this week" />
            <BdCell value={attentionList.length} label="Need attention"  accent={attentionList.length > 0 ? "var(--color-danger)" : undefined} />
          </div>

          {/* ── Attention list (only when there are flagged athletes) ─────── */}
          {attentionList.length > 0 && (
            <AttentionList athletes={attentionList} />
          )}

          {/* ── Roster table ─────────────────────────────────────────────── */}
          <RosterTable roster={roster} />
        </>
      )}
    </div>
  );
}
