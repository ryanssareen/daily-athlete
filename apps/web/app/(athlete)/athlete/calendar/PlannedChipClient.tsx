"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUS_CFG: Record<string, { border: string; bg: string; color: string; label: string }> = {
  planned: {
    border: "var(--color-pine)",
    bg: "color-mix(in oklab, var(--color-pine) 8%, var(--color-canvas-soft))",
    color: "var(--color-pine)",
    label: "planned",
  },
  completed: {
    border: "var(--color-pine)",
    bg: "color-mix(in oklab, var(--color-pine) 12%, var(--color-paper))",
    color: "var(--color-pine)",
    label: "done ✓",
  },
  skipped: {
    border: "var(--color-border-strong)",
    bg: "var(--color-canvas-soft)",
    color: "var(--color-ink-subtle)",
    label: "skipped",
  },
  moved: {
    border: "var(--color-border-strong)",
    bg: "var(--color-canvas-soft)",
    color: "var(--color-ink-muted)",
    label: "moved",
  },
};

function getSportEmoji(sport: string): string {
  const lower = sport.toLowerCase();
  if (lower.includes("run")) return "🏃";
  if (lower.includes("swim")) return "🏊";
  if (lower.includes("bike") || lower.includes("ride")) return "🚴";
  if (lower.includes("strength")) return "💪";
  if (lower.includes("mobility")) return "🧘";
  return "⚡";
}

export default function PlannedChipClient({
  id,
  status,
  sport,
}: {
  id: string;
  status: string;
  sport: string;
}) {
  const router = useRouter();
  const [marking, setMarking] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const cfg = STATUS_CFG[status] ?? {
    border: "var(--color-border)",
    bg: "var(--color-canvas-soft)",
    color: "var(--color-ink-muted)",
    label: status,
  };

  async function handleMarkDone(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setMarking(true);
    setErrMsg("");
    try {
      const res = await fetch(`/api/workouts/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrMsg((body as { error?: string }).error ?? "Failed");
        setMarking(false);
        return;
      }
      router.refresh();
    } catch {
      setErrMsg("Network error");
      setMarking(false);
    }
  }

  return (
    <Link href={`/athlete/planned/${id}` as Route} style={{ textDecoration: "none", display: "block" }}>
      <div
        style={{
          borderLeft: `3px solid ${cfg.border}`,
          background: cfg.bg,
          borderRadius: "0 6px 6px 0",
          padding: "5px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 11, lineHeight: 1 }}>{getSportEmoji(sport)}</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: cfg.color,
              textTransform: "capitalize",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {sport}
          </span>
        </div>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--color-ink-subtle)",
            letterSpacing: "0.04em",
          }}
        >
          {cfg.label}
        </span>
        {status === "planned" && (
          <button
            onClick={handleMarkDone}
            disabled={marking}
            style={{
              marginTop: 3,
              padding: "2px 6px",
              borderRadius: 4,
              border: "1px solid var(--color-pine)",
              background: marking ? "var(--color-canvas-soft)" : "transparent",
              color: marking ? "var(--color-ink-subtle)" : "var(--color-pine)",
              fontSize: 9,
              fontWeight: 600,
              cursor: marking ? "not-allowed" : "pointer",
              letterSpacing: "0.02em",
              lineHeight: 1.4,
            }}
          >
            {marking ? "…" : "✓ done"}
          </button>
        )}
        {errMsg && (
          <span style={{ fontSize: 9, color: "var(--color-danger)", marginTop: 2 }}>
            {errMsg}
          </span>
        )}
      </div>
    </Link>
  );
}
