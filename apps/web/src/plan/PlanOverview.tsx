import Link from "next/link";
import type { Route } from "next";

import type { PlanRow, PlanView } from "@da2/shared";

import { readStructureDurationSeconds } from "@/ai/planned-structure";
import { sportColor, sportLabel } from "@/components/training-overview/sport-colors";

import { formatEventDate } from "./format";
import { cardStyle as card } from "./plan-card-style";
import { PlanForecast } from "./PlanForecast";
import { PlanOutline } from "./PlanOutline";
import { PlanStory } from "./PlanStory";
import { formatDurationShort, summarizePlan, type PlanWorkoutInput } from "./plan-summary";
import { VIEW_ERROR_COPY } from "./plan-view-format";

function daysUntil(dateOnly: string, today: string): number {
  const ms = Date.parse(`${dateOnly}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function formatDay(dateOnly: string): string {
  return new Date(`${dateOnly}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function WorkoutRow({ workout }: { workout: PlanWorkoutInput }) {
  const seconds = readStructureDurationSeconds(workout.structure);
  const meta = [formatDay(workout.scheduled_date), seconds ? formatDurationShort(seconds) : null]
    .filter(Boolean)
    .join(" · ");
  const statusLabel =
    workout.status === "completed" ? "Done" : workout.status === "skipped" ? "Skipped" : null;
  return (
    <Link
      href={`/athlete/planned/${workout.id}` as Route}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 0",
        borderBottom: "1px solid var(--color-border)",
        textDecoration: "none",
      }}
    >
      <span
        aria-hidden
        style={{ width: 10, height: 10, borderRadius: 999, background: sportColor(workout.sport) }}
      />
      <span style={{ flex: 1 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--color-ink)" }}>
          {sportLabel(workout.sport)}
        </span>
        <span style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>{meta}</span>
      </span>
      {statusLabel && (
        <span style={{ fontSize: 12, color: "var(--color-ink-subtle)" }}>{statusLabel}</span>
      )}
    </Link>
  );
}

function ViewErrorCard() {
  return (
    <div data-testid="plan-view-error" role="alert" style={card}>
      <p style={{ fontSize: 14, color: "var(--color-ink-muted)", margin: "0 0 8px" }}>{VIEW_ERROR_COPY}</p>
      <Link href="/plan" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-ink)" }}>
        Try again
      </Link>
    </div>
  );
}

function Eyebrow({ children }: { children: string }) {
  return (
    <p className="eyebrow" style={{ marginBottom: 8 }}>
      {children}
    </p>
  );
}

/**
 * What a plan actually contains -- week progress, weekly volume, sport mix,
 * the next session and this week's sessions -- derived from its planned
 * workouts. Bookkeeping (source, created date) is deliberately a footnote.
 */
export function PlanOverview({
  plan,
  workouts,
  today,
  view,
}: {
  plan: PlanRow;
  workouts: PlanWorkoutInput[];
  today: string;
  view: PlanView | null;
}) {
  if (workouts.length === 0) {
    return (
      <div data-testid="plan-overview-empty" style={card}>
        <p style={{ fontSize: 14, color: "var(--color-ink-muted)", margin: 0 }}>
          No workouts are scheduled for this plan yet.
        </p>
      </div>
    );
  }

  const summary = summarizePlan(workouts, today);
  const weekNumber = summary.currentWeekIndex === null ? null : summary.currentWeekIndex + 1;
  const daysToEvent = plan.event_date ? daysUntil(plan.event_date, today) : null;

  return (
    <div data-testid="plan-overview">
      {view ? <PlanStory story={view.story} /> : <ViewErrorCard />}
      <div style={card}>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--color-ink)", margin: "0 0 2px" }}>
          {weekNumber ? `Week ${weekNumber} of ${summary.weeks.length}` : `${summary.weeks.length}-week plan`}
        </h1>
        <p style={{ fontSize: 13, color: "var(--color-ink-muted)", margin: "0 0 16px" }}>
          {plan.event_type || "Training plan"}
          {plan.event_date &&
            daysToEvent !== null &&
            daysToEvent >= 0 &&
            ` · ${daysToEvent} days to ${formatEventDate(plan.event_date)}`}
        </p>
        <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-ink)", margin: "0 0 8px" }}>
          {summary.done} of {summary.total} sessions done
        </p>
        <div style={{ height: 6, borderRadius: 999, background: "var(--color-border)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${(summary.done / summary.total) * 100}%`,
              background: "var(--color-ink)",
            }}
          />
        </div>
        <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", margin: "8px 0 0" }}>
          {[
            summary.totalDurationS > 0 ? `${formatDurationShort(summary.totalDurationS)} planned in total` : null,
            summary.skipped > 0 ? `${summary.skipped} skipped` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {summary.next && (
        <div style={card}>
          <Eyebrow>Next up</Eyebrow>
          <WorkoutRow workout={summary.next} />
        </div>
      )}

      {view && <PlanForecast forecast={view.forecast} sectionErrors={view.sectionErrors} />}

      {view && <PlanOutline weeks={view.weeks} sectionErrors={view.sectionErrors} today={today} />}

      {summary.sportSeconds.length > 0 && (
        <div style={card}>
          <Eyebrow>Sport mix</Eyebrow>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {summary.sportSeconds.map((s) => (
              <span
                key={s.sport}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: "1px solid var(--color-border)",
                  borderRadius: 999,
                  padding: "4px 12px",
                  fontSize: 13,
                  color: "var(--color-ink)",
                }}
              >
                <span
                  aria-hidden
                  style={{ width: 8, height: 8, borderRadius: 999, background: sportColor(s.sport) }}
                />
                {sportLabel(s.sport)} · {formatDurationShort(s.seconds)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
