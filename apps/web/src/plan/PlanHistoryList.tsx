"use client";

import Link from "next/link";

import type { PlanRow } from "@da2/shared";

const STATUS_LABEL: Record<PlanRow["status"], string> = {
  active: "Active",
  archived: "Archived",
};

function StatusBadge({ status }: { status: PlanRow["status"] }) {
  const isActive = status === "active";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.2,
        textTransform: "uppercase",
        color: isActive ? "var(--color-success)" : "var(--color-ink-muted)",
        background: isActive ? "var(--color-success-soft)" : "var(--color-border)",
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Plan history list for /plans. Each row links to /plans/[id]. Renders the
 * empty state (no plans yet, with a CTA back to /plan for generation) when
 * `plans` is empty.
 */
export function PlanHistoryList({ plans }: { plans: PlanRow[] }) {
  if (plans.length === 0) {
    return (
      <div
        data-testid="state-no-plans"
        style={{
          background: "var(--color-paper)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
          padding: "48px 32px",
          textAlign: "center",
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--color-ink)", margin: "0 0 8px" }}>
          No plans yet
        </h2>
        <p style={{ fontSize: 14, color: "var(--color-ink-muted)", margin: "0 0 20px" }}>
          Once you generate a training plan, it&apos;ll show up here — including
          any plans you later archive or replace.
        </p>
        <Link
          href="/plan"
          style={{
            display: "inline-block",
            border: "1px solid var(--color-border-strong)",
            color: "var(--color-ink)",
            padding: "10px 18px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Generate a plan
        </Link>
      </div>
    );
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {plans.map((plan) => (
        <li key={plan.id}>
          <Link
            href={`/plans/${plan.id}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "16px 20px",
              borderRadius: 12,
              border: "1px solid var(--color-border)",
              background: "var(--color-paper)",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-ink)" }}>
                {plan.event_type || "Training plan"}
                {plan.event_date && (
                  <span style={{ fontWeight: 400, color: "var(--color-ink-muted)" }}>
                    {" "}
                    · {formatDate(plan.event_date)}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", marginTop: 2 }}>
                Created {formatDate(plan.created_at)}
              </div>
            </div>
            <StatusBadge status={plan.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
