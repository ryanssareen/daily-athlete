import { notFound, redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import { getPlannedById } from "@/db/workouts";
import MarkAsDoneButton from "./MarkAsDoneButton";

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  planned: {
    label: "Planned",
    color: "var(--color-pine)",
    bg: "color-mix(in oklab, var(--color-pine) 10%, var(--color-canvas-soft))",
    border: "var(--color-pine)",
  },
  completed: {
    label: "Completed",
    color: "var(--color-pine)",
    bg: "color-mix(in oklab, var(--color-pine) 12%, var(--color-paper))",
    border: "var(--color-pine)",
  },
  skipped: {
    label: "Skipped",
    color: "var(--color-ink-subtle)",
    bg: "var(--color-canvas-soft)",
    border: "var(--color-border-strong)",
  },
  moved: {
    label: "Moved",
    color: "var(--color-ink-muted)",
    bg: "var(--color-canvas-soft)",
    border: "var(--color-border-strong)",
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

function formatScheduledDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function PlannedWorkoutDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const { id } = await params;
  const supabase = await createClient();
  const workout = await getPlannedById(supabase, session.user.id, id);

  if (!workout) notFound();

  const statusCfg = STATUS_CFG[workout.status] ?? {
    label: workout.status,
    color: "var(--color-ink-muted)",
    bg: "var(--color-canvas-soft)",
    border: "var(--color-border)",
  };

  const description =
    typeof workout.structure?.description === "string" && workout.structure.description.trim()
      ? workout.structure.description.trim()
      : null;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 32 }}>{getSportEmoji(workout.sport)}</span>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--color-ink)",
              margin: 0,
              textTransform: "capitalize",
            }}
          >
            {workout.sport}
          </h1>
        </div>
        <p style={{ color: "var(--color-ink-muted)", fontSize: 14, margin: 0 }}>
          {formatScheduledDate(workout.scheduled_date)}
        </p>
      </div>

      {/* Status badge */}
      <div style={{ marginBottom: 24 }}>
        <span
          style={{
            display: "inline-block",
            padding: "4px 12px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: statusCfg.color,
            background: statusCfg.bg,
            border: `1px solid ${statusCfg.border}`,
          }}
        >
          {statusCfg.label}
        </span>
      </div>

      {/* Description */}
      <div
        style={{
          background: "var(--color-paper)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          padding: "20px 24px",
          marginBottom: 28,
        }}
      >
        <p className="eyebrow" style={{ marginBottom: 8 }}>
          Description
        </p>
        <p
          style={{
            fontSize: 14,
            color: description ? "var(--color-ink)" : "var(--color-ink-subtle)",
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {description ?? "No description provided."}
        </p>
      </div>

      {/* Action */}
      {workout.status === "planned" && <MarkAsDoneButton id={id} />}
    </div>
  );
}
