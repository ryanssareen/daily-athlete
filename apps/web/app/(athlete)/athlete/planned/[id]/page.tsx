import Link from "next/link";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import { buildPlannedWorkoutView } from "@/components/planned/planned-workout-view";
import { getPlannedById, getPlannedInRange } from "@/db/workouts";
import { getSportEmoji } from "@/lib/sport-display";
import MarkAsDoneButton from "./MarkAsDoneButton";

function addDaysToDateStr(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayOfWeek = d.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  return d.toISOString().split("T")[0];
}

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

  const prevDateStr = addDaysToDateStr(workout.scheduled_date, -1);
  const nextDateStr = addDaysToDateStr(workout.scheduled_date, 1);

  const [prevDay, nextDay] = await Promise.all([
    getPlannedInRange(supabase, session.user.id, prevDateStr, prevDateStr),
    getPlannedInRange(supabase, session.user.id, nextDateStr, nextDateStr),
  ]);

  // A day with no planned workout has nowhere within this route family to
  // land — fall back to the calendar week containing that date instead of
  // a dead link.
  const prevHref = (prevDay[0]
    ? `/athlete/planned/${prevDay[0].id}`
    : `/athlete/calendar?week=${getMondayOfWeek(prevDateStr)}`) as Route;
  const nextHref = (nextDay[0]
    ? `/athlete/planned/${nextDay[0].id}`
    : `/athlete/calendar?week=${getMondayOfWeek(nextDateStr)}`) as Route;

  const statusCfg = STATUS_CFG[workout.status] ?? {
    label: workout.status,
    color: "var(--color-ink-muted)",
    bg: "var(--color-canvas-soft)",
    border: "var(--color-border)",
  };

  const view = buildPlannedWorkoutView(workout);

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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <p style={{ color: "var(--color-ink-muted)", fontSize: 14, margin: 0 }}>
            {formatScheduledDate(workout.scheduled_date)}
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            <Link
              href={prevHref}
              aria-label="Previous day"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: 8,
                fontSize: 13,
                color: "var(--color-ink-muted)",
                border: "1px solid var(--color-border)",
                background: "var(--color-paper)",
                textDecoration: "none",
              }}
            >
              ←
            </Link>
            <Link
              href={nextHref}
              aria-label="Next day"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: 8,
                fontSize: 13,
                color: "var(--color-ink-muted)",
                border: "1px solid var(--color-border)",
                background: "var(--color-paper)",
                textDecoration: "none",
              }}
            >
              →
            </Link>
          </div>
        </div>
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

      {/* Rationale */}
      {view.rationale && (
        <div
          style={{
            background: "var(--color-paper)",
            border: "1px solid var(--color-border)",
            borderRadius: 14,
            padding: "20px 24px",
            marginBottom: 20,
          }}
        >
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            Why this workout
          </p>
          <p style={{ fontSize: 14, color: "var(--color-ink)", lineHeight: 1.6, margin: 0 }}>
            {view.rationale}
          </p>
        </div>
      )}

      {/* Description */}
      <div
        style={{
          background: "var(--color-paper)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          padding: "20px 24px",
          marginBottom: 20,
        }}
      >
        <p className="eyebrow" style={{ marginBottom: 8 }}>
          Description
        </p>
        <p
          style={{
            fontSize: 14,
            color: view.description ? "var(--color-ink)" : "var(--color-ink-subtle)",
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {view.description ?? "No description provided."}
        </p>
      </div>

      {/* Duration / Load / Intensity */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {[
          { label: "Duration", value: view.durationDisplay },
          { label: "Load", value: view.loadDisplay },
          { label: "Intensity", value: view.intensityDisplay },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              background: "var(--color-paper)",
              border: "1px solid var(--color-border)",
              borderRadius: 14,
              padding: "16px 18px",
            }}
          >
            <p className="eyebrow" style={{ marginBottom: 6 }}>
              {stat.label}
            </p>
            <p style={{ fontSize: 15, fontWeight: 600, color: "var(--color-ink)", margin: 0 }}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Step breakdown (legacy blocks/sets) */}
      {view.steps && view.steps.length > 0 && (
        <div
          style={{
            background: "var(--color-paper)",
            border: "1px solid var(--color-border)",
            borderRadius: 14,
            padding: "20px 24px",
            marginBottom: 28,
          }}
        >
          <p className="eyebrow" style={{ marginBottom: 12 }}>
            Steps
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {view.steps.map((step, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 0",
                  borderTop: i > 0 ? "1px solid var(--color-border)" : "none",
                }}
              >
                <span style={{ fontSize: 14, color: "var(--color-ink)" }}>
                  {step.label ?? "Step"}
                </span>
                <span style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>
                  {step.durationDisplay}
                  {step.intensityDisplay ? ` · ${step.intensityDisplay}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action */}
      {workout.status === "planned" && <MarkAsDoneButton id={id} />}
    </div>
  );
}
