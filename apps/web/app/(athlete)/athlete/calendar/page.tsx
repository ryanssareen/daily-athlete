import Link from "next/link";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import ReviewBanner from "@/adaptive/ReviewBanner";
import {
  getMatchesForPlannedIds,
  getPlannedInRange,
  getWorkoutsInRange,
  type PlannedRow,
  type WorkoutRow,
} from "@/db/workouts";
import PlannedChipClient from "./PlannedChipClient";

// ---------- Helpers -------------------------------------------------------

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getSportColor(sport: string): string {
  const lower = sport.toLowerCase();
  if (lower.includes("run")) return "#2d6a4f";
  if (lower.includes("swim")) return "#2563eb";
  if (lower.includes("bike") || lower.includes("ride")) return "#d97706";
  if (lower.includes("strength")) return "var(--color-clay)";
  if (lower.includes("mobility")) return "#0891b2";
  return "var(--color-ink-subtle)";
}

function getSportEmoji(sport: string): string {
  const lower = sport.toLowerCase();
  if (lower.includes("run")) return "🏃";
  if (lower.includes("swim")) return "🏊";
  if (lower.includes("bike") || lower.includes("ride")) return "🚴";
  if (lower.includes("strength")) return "💪";
  if (lower.includes("mobility")) return "🧘";
  return "⚡";
}

function getMondayOfWeek(dateStr?: string): Date {
  const base = dateStr ? new Date(dateStr + "T00:00:00Z") : new Date();
  const dayOfWeek = base.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() - daysFromMonday);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

function toDateString(d: Date): string {
  return d.toISOString().split("T")[0];
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setUTCDate(d.getUTCDate() + n);
  return result;
}

function formatMonthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function formatWeekRange(mon: Date, sun: Date): string {
  const m = mon.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const s = sun.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${m} – ${s}`;
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}`;
  return `${m}m`;
}

function formatDistance(m: number): string {
  return `${(m / 1000).toFixed(1)} km`;
}

// ---------- Chips ---------------------------------------------------------

function PlannedChip({ p }: { p: PlannedRow }) {
  const cfg = (
    {
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
    } as Record<string, { border: string; bg: string; color: string; label: string }>
  )[p.status] ?? {
    border: "var(--color-border)",
    bg: "var(--color-canvas-soft)",
    color: "var(--color-ink-muted)",
    label: p.status,
  };

  return (
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
        <span style={{ fontSize: 11, lineHeight: 1 }}>{getSportEmoji(p.sport)}</span>
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
          {p.sport}
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
    </div>
  );
}

function CompletedChip({ w }: { w: WorkoutRow }) {
  const color = getSportColor(w.sport);
  return (
    <Link
      href={`/athlete/workouts/${w.id}?from=calendar`}
      style={{
        borderLeft: `3px solid ${color}`,
        background: `color-mix(in oklab, ${color} 10%, var(--color-paper))`,
        borderRadius: "0 6px 6px 0",
        padding: "5px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        textDecoration: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 11, lineHeight: 1 }}>{getSportEmoji(w.sport)}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color,
            textTransform: "capitalize",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {w.sport}
        </span>
      </div>
      {(w.duration_s != null || (w.distance_m != null && w.distance_m > 0)) && (
        <div
          style={{
            display: "flex",
            gap: 5,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--color-ink-muted)",
          }}
        >
          {w.duration_s != null && <span>{formatDuration(w.duration_s)}</span>}
          {w.distance_m != null && w.distance_m > 0 && (
            <>
              <span style={{ color: "var(--color-border-strong)" }}>·</span>
              <span>{formatDistance(w.distance_m)}</span>
            </>
          )}
        </div>
      )}
    </Link>
  );
}

// ---------- Page ----------------------------------------------------------

export default async function AthleteCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const params = await searchParams;
  const monday = getMondayOfWeek(params.week);
  const sunday = addDays(monday, 6);
  const sundayEnd = new Date(sunday);
  sundayEnd.setUTCHours(23, 59, 59, 999);

  const fromStr = toDateString(monday);
  const toStr = toDateString(sunday);

  const prevMonday = toDateString(addDays(monday, -7));
  const nextMonday = toDateString(addDays(monday, 7));

  const supabase = await createClient();
  const userId = session.user.id;

  const [planned, completed] = await Promise.all([
    getPlannedInRange(supabase, userId, fromStr, toStr),
    getWorkoutsInRange(supabase, userId, monday.toISOString(), sundayEnd.toISOString()),
  ]);

  // A planned workout with a live match renders as one card carrying the
  // completed workout's stats, instead of two unlinked chips (planned +
  // completed) for the same session.
  const matches = await getMatchesForPlannedIds(
    supabase,
    planned.map((p) => p.id)
  );
  const matchedCompletedByPlannedId = new Map(
    matches.map((m) => [m.planned_workout_id, m.completed_workout])
  );
  const matchedCompletedIds = new Set(matches.map((m) => m.completed_workout.id));

  const plannedByDay = new Map<string, PlannedRow[]>();
  for (const p of planned) {
    if (!plannedByDay.has(p.scheduled_date)) plannedByDay.set(p.scheduled_date, []);
    plannedByDay.get(p.scheduled_date)!.push(p);
  }

  const completedByDay = new Map<string, WorkoutRow[]>();
  for (const w of completed) {
    if (matchedCompletedIds.has(w.id)) continue; // rendered via its matched planned chip instead
    const day = w.started_at.split("T")[0];
    if (!completedByDay.has(day)) completedByDay.set(day, []);
    completedByDay.get(day)!.push(w);
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    const dateStr = toDateString(d);
    return {
      name: DAY_NAMES[i],
      dateStr,
      dayNum: d.getUTCDate(),
      planned: plannedByDay.get(dateStr) ?? [],
      completed: completedByDay.get(dateStr) ?? [],
    };
  });

  const todayStr = toDateString(new Date());

  const navButtonStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 32,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    color: "var(--color-ink-muted)",
    border: "1px solid var(--color-border)",
    background: "var(--color-paper)",
    textDecoration: "none",
  } as const;

  return (
    <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
      {/* AI adaptive "review ready" banner (Unit 11). */}
      <ReviewBanner athleteId={userId} />

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 20,
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--color-ink)",
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            {formatMonthYear(monday)}
          </h1>
          <p style={{ color: "var(--color-ink-muted)", marginTop: 6, fontSize: 14, margin: "6px 0 0" }}>
            {formatWeekRange(monday, sunday)}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link
            href="/athlete/workouts/new"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 16px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              background: "var(--color-ink)",
              color: "var(--color-canvas)",
            }}
          >
            + Log workout
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Link href={`/athlete/calendar?week=${prevMonday}`} style={{ ...navButtonStyle, width: 32 }}>
              ←
            </Link>
            <Link href="/athlete/calendar" style={{ ...navButtonStyle, padding: "0 14px" }}>
              Today
            </Link>
            <Link href={`/athlete/calendar?week=${nextMonday}`} style={{ ...navButtonStyle, width: 32 }}>
              →
            </Link>
          </div>
        </div>
      </div>

      {/* Calendar grid */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          overflow: "hidden",
          background: "var(--color-border)",
        }}
      >
        {/* Day headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0 1px" }}>
          {days.map((day) => {
            const isToday = day.dateStr === todayStr;
            return (
              <div
                key={day.dateStr + "-h"}
                style={{
                  background: "var(--color-canvas-soft)",
                  padding: "12px 12px 10px",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <p
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: isToday ? "var(--color-clay)" : "var(--color-ink-subtle)",
                    margin: 0,
                  }}
                >
                  {day.name}
                </p>

                {isToday ? (
                  <div
                    style={{
                      marginTop: 4,
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: "var(--color-clay)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
                      {day.dayNum}
                    </span>
                  </div>
                ) : (
                  <p
                    style={{
                      fontSize: 22,
                      fontWeight: 600,
                      color: "var(--color-ink)",
                      margin: "3px 0 0",
                      lineHeight: 1,
                    }}
                  >
                    {day.dayNum}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Day body cells */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0 1px" }}>
          {days.map((day) => {
            const isToday = day.dateStr === todayStr;
            const isEmpty = day.planned.length === 0 && day.completed.length === 0;
            return (
              <div
                key={day.dateStr + "-b"}
                style={{
                  background: isToday
                    ? "color-mix(in oklab, var(--color-clay) 3%, var(--color-paper))"
                    : "var(--color-paper)",
                  minHeight: 200,
                  padding: "10px 8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {isEmpty && (
                  <p
                    style={{
                      fontSize: 11,
                      color: "var(--color-border-strong)",
                      margin: "4px 2px 0",
                      fontStyle: "italic",
                    }}
                  >
                    Rest
                  </p>
                )}
                {day.planned.map((p) => (
                  <PlannedChipClient
                    key={p.id}
                    id={p.id}
                    status={p.status}
                    sport={p.sport}
                    editedByKind={p.edited_by_kind}
                    matchedCompleted={matchedCompletedByPlannedId.get(p.id) ?? null}
                  />
                ))}
                {day.completed.map((w) => (
                  <CompletedChip key={w.id} w={w} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
