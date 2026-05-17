import Link from "next/link";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import {
  getPlannedInRange,
  getWorkoutsInRange,
  type PlannedRow,
  type WorkoutRow,
} from "@/db/workouts";

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

function formatDurationLong(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
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
    <div
      style={{
        borderLeft: `3px solid ${color}`,
        background: `color-mix(in oklab, ${color} 10%, var(--color-paper))`,
        borderRadius: "0 6px 6px 0",
        padding: "5px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
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
    </div>
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

  const plannedByDay = new Map<string, PlannedRow[]>();
  for (const p of planned) {
    if (!plannedByDay.has(p.scheduled_date)) plannedByDay.set(p.scheduled_date, []);
    plannedByDay.get(p.scheduled_date)!.push(p);
  }

  const completedByDay = new Map<string, WorkoutRow[]>();
  for (const w of completed) {
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
  const totalDurationS = completed.reduce((s, w) => s + (w.duration_s ?? 0), 0);
  const totalDistanceM = completed.reduce((s, w) => s + (w.distance_m ?? 0), 0);

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
    <div style={{ width: "100%" }}>
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
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--color-ink)",
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            {formatMonthYear(monday)}
          </h1>
          <p style={{ color: "var(--color-ink-muted)", marginTop: 4, fontSize: 13, margin: "4px 0 0" }}>
            {formatWeekRange(monday, sunday)}
          </p>
        </div>

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

      {/* Calendar grid */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          overflow: "hidden",
          marginBottom: 20,
          background: "var(--color-border)", // 1px gaps between columns
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
                  padding: "10px 10px 9px",
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
                      fontSize: 20,
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
                  minHeight: 180,
                  padding: "8px 6px",
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
                  <PlannedChip key={p.id} p={p} />
                ))}
                {day.completed.map((w) => (
                  <CompletedChip key={w.id} w={w} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Week summary */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {[
          { label: "Completed", value: completed.length.toString(), sub: "workouts" },
          { label: "Time", value: totalDurationS > 0 ? formatDurationLong(totalDurationS) : "—", sub: "total" },
          ...(totalDistanceM > 0 ? [{ label: "Distance", value: formatDistance(totalDistanceM), sub: "total" }] : []),
          ...(planned.length > 0 ? [{ label: "Planned", value: planned.length.toString(), sub: "workouts" }] : []),
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              background: "var(--color-paper)",
              border: "1px solid var(--color-border)",
              borderRadius: 10,
              padding: "10px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
            <span className="eyebrow">{stat.label}</span>
            <span
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: "var(--color-ink)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "-0.02em",
                lineHeight: 1.3,
              }}
            >
              {stat.value}
            </span>
            <span style={{ fontSize: 11, color: "var(--color-ink-subtle)" }}>{stat.sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
