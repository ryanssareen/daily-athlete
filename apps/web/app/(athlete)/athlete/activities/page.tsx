import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import { getRecentWorkouts, type WorkoutRow } from "@/db/workouts";
import { formatDuration, formatDistance, formatPace } from "@/lib/format";

// ─── Sport config ────────────────────────────────────────────────────────────

const SPORT_CONFIG: Record<string, { typeLabel: string; color: string; bg: string; emoji: string }> = {
  run:      { typeLabel: "RUNNING",           color: "#c45a30", bg: "#f6e0d2", emoji: "🏃" },
  swim:     { typeLabel: "POOL SWIM",         color: "#1a6891", bg: "#cde6f5", emoji: "🏊" },
  bike:     { typeLabel: "CYCLING",           color: "#2d6b44", bg: "#c6ddd5", emoji: "🚴" },
  ride:     { typeLabel: "CYCLING",           color: "#2d6b44", bg: "#c6ddd5", emoji: "🚴" },
  strength: { typeLabel: "STRENGTH TRAINING", color: "#4a3a80", bg: "#d8d4ee", emoji: "🏋️" },
  mobility: { typeLabel: "MOBILITY",          color: "#6b4c22", bg: "#ead9c4", emoji: "🧘" },
};

function getSportConfig(sport: string) {
  return SPORT_CONFIG[sport.toLowerCase()] ?? {
    typeLabel: sport.toUpperCase(),
    color: "var(--color-ink-muted)",
    bg: "var(--color-canvas-soft)",
    emoji: "⚡",
  };
}

// ─── Activity name ────────────────────────────────────────────────────────────

function getActivityName(w: WorkoutRow): string {
  const s = w.summary_stats;
  if (typeof s.name === "string" && s.name.trim()) return s.name.trim();
  const cfg = getSportConfig(w.sport);
  return cfg.typeLabel
    .split(" ")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

// ─── Stat columns ─────────────────────────────────────────────────────────────

type Stat = { value: string; label: string };

function getStats(w: WorkoutRow): Stat[] {
  const s = w.summary_stats;
  const avgHr = typeof s.average_heartrate === "number" ? Math.round(s.average_heartrate) : null;
  const maxHr = typeof s.max_heartrate === "number" ? Math.round(s.max_heartrate) : null;
  const avgSpeed = typeof s.average_speed === "number" ? s.average_speed : null; // m/s
  const avgWatts = typeof s.average_watts === "number" ? Math.round(s.average_watts) : null;
  const elevGain = typeof s.total_elevation_gain === "number" ? Math.round(s.total_elevation_gain) : null;
  const sport = w.sport.toLowerCase();

  if (sport === "run") return [
    { value: formatDistance(w.distance_m, "run"), label: "DISTANCE" },
    { value: formatDuration(w.duration_s), label: "TIME" },
    { value: formatPace(w.distance_m, w.duration_s, "run") ?? "—", label: "AVG PACE" },
    { value: avgHr != null ? `${avgHr} bpm` : "—", label: "AVG HR" },
    { value: elevGain != null ? `${elevGain} m` : "—", label: "ELEVATION" },
  ];

  if (sport === "swim") return [
    { value: formatDistance(w.distance_m, "swim"), label: "DISTANCE" },
    { value: formatDuration(w.duration_s), label: "TIME" },
    { value: formatPace(w.distance_m, w.duration_s, "swim") ?? "—", label: "AVG PACE" },
    { value: avgHr != null ? `${avgHr} bpm` : "—", label: "AVG HR" },
    { value: "—", label: "SWOLF" },
  ];

  if (sport === "bike" || sport === "ride") return [
    { value: formatDistance(w.distance_m, "bike"), label: "DISTANCE" },
    { value: formatDuration(w.duration_s), label: "TIME" },
    { value: avgSpeed != null ? `${(avgSpeed * 3.6).toFixed(1)} km/h` : "—", label: "AVG SPEED" },
    { value: avgWatts != null ? `${avgWatts} W` : "—", label: "AVG POWER" },
    { value: avgHr != null ? `${avgHr} bpm` : "—", label: "AVG HR" },
  ];

  if (sport === "strength") return [
    { value: formatDuration(w.duration_s), label: "TIME" },
    { value: avgHr != null ? `${avgHr} bpm` : "—", label: "AVG HR" },
    { value: maxHr != null ? `${maxHr} bpm` : "—", label: "MAX HR" },
    { value: "—", label: "CALORIES" },
    { value: "", label: "" },
  ];

  return [
    { value: formatDistance(w.distance_m, sport), label: "DISTANCE" },
    { value: formatDuration(w.duration_s), label: "TIME" },
    { value: avgHr != null ? `${avgHr} bpm` : "—", label: "AVG HR" },
    { value: "", label: "" },
    { value: "", label: "" },
  ];
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function fmtYear(iso: string) {
  return new Date(iso).getUTCFullYear().toString();
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────

const TABS = [
  { label: "All",      value: "" },
  { label: "Run",      value: "run" },
  { label: "Swim",     value: "swim" },
  { label: "Bike",     value: "bike" },
  { label: "Strength", value: "strength" },
  { label: "Mobility", value: "mobility" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AthleteActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string }>;
}) {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const { sport: sportFilter } = await searchParams;
  const supabase = await createClient();
  const workouts = await getRecentWorkouts(supabase, session.user.id, 100, sportFilter || undefined);

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "var(--color-ink)",
            margin: 0,
          }}
        >
          Activities
        </h1>
      </div>

      {/* Sport filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((tab) => {
          const active = (sportFilter ?? "") === tab.value;
          const href = tab.value
            ? (`/athlete/activities?sport=${tab.value}` as Route)
            : ("/athlete/activities" as Route);
          return (
            <Link
              key={tab.value}
              href={href}
              style={{
                padding: "5px 14px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 500,
                textDecoration: "none",
                background: active ? "var(--color-ink)" : "var(--color-paper)",
                color: active ? "var(--color-canvas)" : "var(--color-ink-muted)",
                border: "1px solid",
                borderColor: active ? "var(--color-ink)" : "var(--color-border)",
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/* Activity count */}
      {workouts.length > 0 && (
        <p
          style={{
            fontSize: 12,
            color: "var(--color-ink-muted)",
            marginBottom: 12,
            fontFamily: "var(--font-mono)",
          }}
        >
          {workouts.length} {workouts.length === 1 ? "activity" : "activities"}
        </p>
      )}

      {/* Table */}
      {workouts.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          style={{
            background: "var(--color-paper)",
            border: "1px solid var(--color-border)",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          {/* Column header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "56px 36px 1fr repeat(5, minmax(80px, 100px))",
              gap: 12,
              padding: "8px 20px",
              borderBottom: "1px solid var(--color-border)",
              background: "var(--color-canvas-soft)",
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "var(--color-ink-muted)" }}>DATE</div>
            <div />
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "var(--color-ink-muted)" }}>ACTIVITY</div>
            {["STAT 1", "STAT 2", "STAT 3", "STAT 4", "STAT 5"].map((_, i) => (
              <div key={i} />
            ))}
          </div>

          {workouts.map((w, i) => {
            const cfg = getSportConfig(w.sport);
            const stats = getStats(w);
            const name = getActivityName(w);

            return (
              <Link
                key={w.id}
                href={`/athlete/workouts/${w.id}?from=activities` as Route}
                style={{
                  display: "grid",
                  gridTemplateColumns: "56px 36px 1fr repeat(5, minmax(80px, 100px))",
                  alignItems: "center",
                  gap: 12,
                  padding: "11px 20px",
                  borderBottom: i < workouts.length - 1 ? "1px solid var(--color-border)" : "none",
                  textDecoration: "none",
                  color: "inherit",
                  transition: "background 0.08s",
                }}
                className="activity-row"
              >
                {/* Date */}
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-ink)",
                      lineHeight: 1.25,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fmtDay(w.started_at)}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--color-ink-muted)",
                      lineHeight: 1.4,
                    }}
                  >
                    {fmtYear(w.started_at)}
                  </div>
                </div>

                {/* Sport icon */}
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: cfg.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                >
                  {cfg.emoji}
                </div>

                {/* Name + type */}
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-ink)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      lineHeight: 1.3,
                    }}
                  >
                    {name}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                      color: cfg.color,
                      lineHeight: 1.4,
                    }}
                  >
                    {cfg.typeLabel}
                  </div>
                </div>

                {/* Stat columns */}
                {stats.map((stat, si) => (
                  <div key={si} style={{ textAlign: "right" }}>
                    {stat.value ? (
                      <>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            fontFamily: "var(--font-mono)",
                            color: "var(--color-ink)",
                            lineHeight: 1.25,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {stat.value}
                        </div>
                        {stat.label && (
                          <div
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              letterSpacing: "0.06em",
                              color: "var(--color-ink-muted)",
                              lineHeight: 1.4,
                            }}
                          >
                            {stat.label}
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                ))}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      style={{
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 16,
        padding: "56px 40px",
        textAlign: "center",
      }}
    >
      <p style={{ fontSize: 32, marginBottom: 12, lineHeight: 1 }}>⚡</p>
      <p
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: "var(--color-ink)",
          marginBottom: 8,
        }}
      >
        No activities yet
      </p>
      <p
        style={{
          fontSize: 14,
          color: "var(--color-ink-muted)",
          marginBottom: 24,
        }}
      >
        Connect Strava to sync your workouts automatically.
      </p>
      <Link
        href={"/athlete/settings" as Route}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "9px 18px",
          borderRadius: 999,
          fontSize: 14,
          fontWeight: 500,
          background: "var(--color-ink)",
          color: "var(--color-canvas)",
          textDecoration: "none",
        }}
      >
        Connect Strava
      </Link>
    </div>
  );
}
