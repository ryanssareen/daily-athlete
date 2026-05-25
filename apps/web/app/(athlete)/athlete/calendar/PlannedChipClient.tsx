"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { EditedByKind } from "@da2/shared";

import { getSportEmoji } from "@/lib/sport-display";
import type { PlannedStatus } from "@/db/workouts";

// Distinct attribution chip per editor — ai_review must read differently from a
// coach edit (Unit 11). NULL / athlete edits get no badge (the default case).
const ATTRIBUTION_CFG: Partial<
  Record<EditedByKind, { label: string; bg: string; color: string; border: string }>
> = {
  ai_review: {
    label: "✦ AI",
    bg: "color-mix(in oklab, var(--color-clay) 16%, transparent)",
    color: "var(--color-clay-deep)",
    border: "color-mix(in oklab, var(--color-clay) 32%, transparent)",
  },
  coach: {
    label: "Coach",
    bg: "color-mix(in oklab, var(--color-pine) 14%, transparent)",
    color: "var(--color-pine)",
    border: "color-mix(in oklab, var(--color-pine) 30%, transparent)",
  },
};

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

export default function PlannedChipClient({
  id,
  status,
  sport,
  editedByKind = null,
}: {
  id: string;
  status: PlannedStatus;
  sport: string;
  editedByKind?: EditedByKind | null;
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

  const attribution = editedByKind ? ATTRIBUTION_CFG[editedByKind] : undefined;

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
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrMsg((body as { error?: string }).error ?? "Failed");
        return;
      }
      router.refresh();
    } catch {
      setErrMsg("Network error");
    } finally {
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
              flex: 1,
            }}
          >
            {sport}
          </span>
          {attribution && (
            <span
              data-attribution={editedByKind ?? undefined}
              title={
                editedByKind === "ai_review"
                  ? "Adjusted by an AI review you approved"
                  : "Edited by your coach"
              }
              style={{
                flexShrink: 0,
                padding: "0 4px",
                borderRadius: 4,
                fontSize: 8,
                fontWeight: 700,
                lineHeight: 1.6,
                letterSpacing: "0.02em",
                background: attribution.bg,
                color: attribution.color,
                border: `1px solid ${attribution.border}`,
              }}
            >
              {attribution.label}
            </span>
          )}
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
