import Link from "next/link";

import type { PlanRow } from "@da2/shared";

import { formatDate, formatEventDate } from "./format";

const SOURCE_LABEL: Record<PlanRow["source"], string> = {
  ai_generated: "AI-generated",
  coach_assigned: "Assigned by your coach",
  imported: "Imported",
};

/**
 * Direct, server-rendered summary of the athlete's active plan -- what it's
 * for, when it was made, and how much of it is still ahead. Replaces the
 * generic "Your plan is active" empty state that told the athlete nothing
 * about their actual plan.
 */
export function PlanSummaryCard({
  plan,
  upcomingCount,
}: {
  plan: PlanRow;
  upcomingCount: number;
}) {
  return (
    <div
      data-testid="plan-summary"
      style={{
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 16,
        padding: "24px 28px",
        marginBottom: 20,
      }}
    >
      <p className="eyebrow" style={{ marginBottom: 6 }}>
        {SOURCE_LABEL[plan.source]}
      </p>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--color-ink)", margin: "0 0 4px" }}>
        {plan.event_type || "Training plan"}
      </h1>
      <p style={{ fontSize: 13, color: "var(--color-ink-muted)", margin: "0 0 18px" }}>
        {plan.event_date && `Event ${formatEventDate(plan.event_date)} · `}
        Started {formatDate(plan.created_at)}
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 600, color: "var(--color-ink)" }}>
            {upcomingCount}
          </div>
          <div style={{ fontSize: 12, color: "var(--color-ink-subtle)" }}>
            {upcomingCount === 1 ? "workout" : "workouts"} still ahead
          </div>
        </div>
      </div>
      <Link
        href="/athlete/calendar"
        style={{
          display: "inline-block",
          marginTop: 18,
          fontSize: 13,
          fontWeight: 600,
          color: "var(--color-ink)",
        }}
      >
        View on calendar →
      </Link>
    </div>
  );
}
