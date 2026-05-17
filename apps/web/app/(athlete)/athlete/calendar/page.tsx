import Link from "next/link";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import { getPlannedInRange, getWorkoutsInRange, type PlannedRow, type WorkoutRow } from "@/db/workouts";

// ---------- Helpers -------------------------------------------------------

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const sportEmoji: Record<string, string> = {
  swim: "🏊",
  bike: "🚴",
  ride: "🚴",
  run: "🏃",
  strength: "💪",
  mobility: "🧘",
};

function getSportEmoji(sport: string): string {
  const lower = sport.toLowerCase();
  for (const [key, emoji] of Object.entries(sportEmoji)) {
    if (lower.includes(key)) return emoji;
  }
  return "⚡";
}

function getMondayOfWeek(dateStr?: string): Date {
  let base: Date;
  if (dateStr) {
    base = new Date(dateStr + "T00:00:00Z");
  } else {
    base = new Date();
  }
  const dayOfWeek = base.getUTCDay(); // 0=Sun, 1=Mon,...6=Sat
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

function formatWeekLabel(monday: Date): string {
  return monday.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}

function formatDistance(m: number): string {
  return `${(m / 1000).toFixed(1)} km`;
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const statusColors: Record<string, { bg: string; text: string; border: string }> = {
  planned: {
    bg: "color-mix(in oklab, var(--color-pine) 12%, transparent)",
    text: "var(--color-pine)",
    border: "color-mix(in oklab, var(--color-pine) 25%, transparent)",
  },
  completed: {
    bg: "color-mix(in oklab, var(--color-clay) 12%, transparent)",
    text: "var(--color-clay-deep)",
    border: "color-mix(in oklab, var(--color-clay) 25%, transparent)",
  },
  skipped: {
    bg: "var(--color-canvas-soft)",
    text: "var(--color-ink-subtle)",
    border: "var(--color-border)",
  },
  moved: {
    bg: "var(--color-canvas-soft)",
    text: "var(--color-ink-muted)",
    border: "var(--color-border)",
  },
};

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
  const fromISO = monday.toISOString();
  const toISO = sundayEnd.toISOString();

  const prevMonday = toDateString(addDays(monday, -7));
  const nextMonday = toDateString(addDays(monday, 7));

  const supabase = await createClient();
  const userId = session.user.id;

  const [planned, completed] = await Promise.all([
    getPlannedInRange(supabase, userId, fromStr, toStr),
    getWorkoutsInRange(supabase, userId, fromISO, toISO),
  ]);

  // Build day-keyed maps
  const plannedByDay = new Map<string, PlannedRow[]>();
  for (const p of planned) {
    const day = p.scheduled_date;
    if (!plannedByDay.has(day)) plannedByDay.set(day, []);
    plannedByDay.get(day)!.push(p);
  }

  const completedByDay = new Map<string, WorkoutRow[]>();
  for (const w of completed) {
    const day = w.started_at.split("T")[0];
    if (!completedByDay.has(day)) completedByDay.set(day, []);
    completedByDay.get(day)!.push(w);
  }

  // Build 7-day columns
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    const dateStr = toDateString(d);
    return {
      name: DAY_NAMES[i],
      date: d,
      dateStr,
      dayNum: d.getUTCDate(),
      planned: plannedByDay.get(dateStr) ?? [],
      completed: completedByDay.get(dateStr) ?? [],
    };
  });

  const weekLabel = formatWeekLabel(monday);
  const yearStr = monday.getUTCFullYear() === new Date().getUTCFullYear()
    ? ""
    : `, ${monday.getUTCFullYear()}`;

  return (
    <div style={{ maxWidth: 960 }}>
      {/* Header + nav */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 28,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "var(--color-ink)",
              margin: 0,
            }}
          >
            Calendar
          </h1>
          <p style={{ color: "var(--color-ink-muted)", marginTop: 4, fontSize: 15 }}>
            Week of {weekLabel}{yearStr}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link
            href={`/athlete/calendar?week=${prevMonday}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 14px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 500,
              color: "var(--color-ink-muted)",
              border: "1px solid var(--color-border)",
              background: "var(--color-paper)",
            }}
          >
            ← Prev
          </Link>
          <Link
            href="/athlete/calendar"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 14px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 500,
              color: "var(--color-ink-muted)",
              border: "1px solid var(--color-border)",
              background: "var(--color-paper)",
            }}
          >
            Today
          </Link>
          <Link
            href={`/athlete/calendar?week=${nextMonday}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 14px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 500,
              color: "var(--color-ink-muted)",
              border: "1px solid var(--color-border)",
              background: "var(--color-paper)",
            }}
          >
            Next →
          </Link>
        </div>
      </div>

      {/* 7-column grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 8,
          marginBottom: 40,
        }}
      >
        {days.map((day) => {
          const isToday = toDateString(new Date()) === day.dateStr;
          const isEmpty = day.planned.length === 0 && day.completed.length === 0;

          return (
            <div
              key={day.dateStr}
              style={{
                background: "var(--color-paper)",
                border: `1px solid ${isToday ? "var(--color-clay)" : "var(--color-border)"}`,
                borderRadius: 12,
                padding: "12px 10px",
                minHeight: 120,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {/* Day header */}
              <div style={{ marginBottom: 4 }}>
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--color-ink-subtle)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    margin: 0,
                  }}
                >
                  {day.name}
                </p>
                <p
                  style={{
                    fontSize: 18,
                    fontWeight: isToday ? 700 : 500,
                    color: isToday ? "var(--color-clay)" : "var(--color-ink)",
                    margin: 0,
                    lineHeight: 1.2,
                  }}
                >
                  {day.dayNum}
                </p>
              </div>

              {isEmpty && (
                <p style={{ fontSize: 11, color: "var(--color-ink-subtle)", margin: 0 }}>
                  Rest
                </p>
              )}

              {/* Planned workouts */}
              {day.planned.map((p) => {
                const colors = statusColors[p.status] ?? statusColors.planned;
                return (
                  <div
                    key={p.id}
                    style={{
                      padding: "4px 7px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 500,
                      background: colors.bg,
                      color: colors.text,
                      border: `1px solid ${colors.border}`,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 12 }}>{getSportEmoji(p.sport)}</span>
                    <span style={{ textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.sport}
                    </span>
                  </div>
                );
              })}

              {/* Completed workouts */}
              {day.completed.map((w) => (
                <div
                  key={w.id}
                  style={{
                    padding: "4px 7px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 500,
                    background: "color-mix(in oklab, var(--color-clay) 12%, transparent)",
                    color: "var(--color-clay-deep)",
                    border: "1px solid color-mix(in oklab, var(--color-clay) 25%, transparent)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <span style={{ fontSize: 12 }}>{getSportEmoji(w.sport)}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {w.duration_s ? formatDuration(w.duration_s) : w.sport}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Completed workouts detail list */}
      {completed.length > 0 && (
        <section>
          <p className="eyebrow" style={{ marginBottom: 14 }}>
            Completed this week
          </p>
          <div
            style={{
              background: "var(--color-paper)",
              border: "1px solid var(--color-border)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            {completed.map((w, i) => (
              <div
                key={w.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 20px",
                  borderBottom:
                    i < completed.length - 1 ? "1px solid var(--color-border)" : "none",
                }}
              >
                <span style={{ fontSize: 20, lineHeight: 1, width: 28, textAlign: "center" }}>
                  {getSportEmoji(w.sport)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontWeight: 500,
                      fontSize: 14,
                      color: "var(--color-ink)",
                      textTransform: "capitalize",
                      margin: 0,
                    }}
                  >
                    {w.sport}
                  </p>
                  <p style={{ fontSize: 12, color: "var(--color-ink-muted)", margin: 0 }}>
                    {formatDateShort(w.started_at)}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  {w.duration_s != null && (
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                        color: "var(--color-ink)",
                        margin: 0,
                      }}
                    >
                      {formatDuration(w.duration_s)}
                    </p>
                  )}
                  {w.distance_m != null && w.distance_m > 0 && (
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: "var(--color-ink-muted)",
                        margin: 0,
                      }}
                    >
                      {formatDistance(w.distance_m)}
                    </p>
                  )}
                </div>
                <span
                  style={{
                    flexShrink: 0,
                    padding: "3px 8px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 500,
                    fontFamily: "var(--font-mono)",
                    background:
                      w.source === "strava"
                        ? "color-mix(in oklab, var(--color-clay) 15%, transparent)"
                        : "var(--color-canvas-soft)",
                    color:
                      w.source === "strava"
                        ? "var(--color-clay-deep)"
                        : "var(--color-ink-muted)",
                    border:
                      w.source === "strava"
                        ? "1px solid color-mix(in oklab, var(--color-clay) 30%, transparent)"
                        : "1px solid var(--color-border)",
                    textTransform: "capitalize",
                  }}
                >
                  {w.source}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
