import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { getWorkoutById } from "@/db/workouts";
import { hasStravaToken } from "@/db/strava-tokens";
import { getSportEmoji, getSportLabel } from "@/lib/sport-display";
import { formatDuration, formatDistance, formatPace, formatWorkoutDateTime } from "@/lib/format";
import MapSection from "./MapSection";
import SyncButton from "./SyncButton";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
};

// ─── Back nav ─────────────────────────────────────────────────────────────────

const VALID_FROM = new Set(["dashboard", "activities", "calendar"]);

function backHrefFor(from: string | undefined): Route {
  if (from && VALID_FROM.has(from)) {
    if (from === "dashboard") return "/athlete" as Route;
    return `/athlete/${from}` as Route;
  }
  return "/athlete/activities" as Route;
}

function backLabelFor(from: string | undefined): string {
  if (from === "dashboard") return "← Dashboard";
  if (from === "calendar") return "← Calendar";
  return "← Activities";
}

// ─── Sport accent colors (matches activities page) ────────────────────────────

const SPORT_ACCENT: Record<string, { color: string; bg: string }> = {
  run:      { color: "#c45a30", bg: "color-mix(in oklab, #c45a30 8%, transparent)" },
  swim:     { color: "#1a6891", bg: "color-mix(in oklab, #1a6891 8%, transparent)" },
  bike:     { color: "#2d6b44", bg: "color-mix(in oklab, #2d6b44 8%, transparent)" },
  ride:     { color: "#2d6b44", bg: "color-mix(in oklab, #2d6b44 8%, transparent)" },
  strength: { color: "#4a3a80", bg: "color-mix(in oklab, #4a3a80 8%, transparent)" },
  mobility: { color: "#6b4c22", bg: "color-mix(in oklab, #6b4c22 8%, transparent)" },
};

function sportAccent(sport: string) {
  return SPORT_ACCENT[sport.toLowerCase()] ?? { color: "var(--color-ink-muted)", bg: "var(--color-canvas-soft)" };
}

// ─── Stat strip item ──────────────────────────────────────────────────────────

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "0 20px",
        borderRight: "1px solid var(--color-border)",
        minWidth: 90,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-ink-muted)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 22,
          fontWeight: 700,
          color: accent ? "var(--color-clay)" : "var(--color-ink)",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Keys shown in named sections ─────────────────────────────────────────────

const NAMED_KEYS = new Set([
  "average_speed", "max_speed",
  "average_heartrate", "max_heartrate",
  "average_watts", "max_watts",
  "total_elevation_gain",
  "suffer_score",
  "average_cadence",
  "name",
  "polyline",
]);

function labelFor(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AthleteWorkoutDetailPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const from = sp.from;
  const backHref = backHrefFor(from);
  const backLabel = backLabelFor(from);

  const [session, supabase] = await Promise.all([getUserWithRoles(), createClient()]);
  if (!session) redirect("/sign-in");

  const workout = await getWorkoutById(supabase, session.user.id, id);
  if (!workout) redirect(backHref);

  const stats = workout.summary_stats;
  const isStrava = workout.source === "strava";
  const sport = workout.sport;
  const accent = sportAccent(sport);

  let showStravaConnect = false;
  if (!isStrava) {
    const admin = createAdminClient();
    showStravaConnect = !(await hasStravaToken(admin, session.user.id));
  }

  // Core display values
  const workoutName = (stats.name as string | null) ?? getSportLabel(sport);
  const dateTime = formatWorkoutDateTime(workout.started_at, session.timezone);
  const durationStr = formatDuration(workout.duration_s);
  const distanceStr = sport !== "strength" ? formatDistance(workout.distance_m, sport) : null;
  const paceStr = formatPace(workout.distance_m, workout.duration_s, sport);
  const polyline = typeof stats.polyline === "string" ? stats.polyline : null;

  // Stats
  const avgHR = typeof stats.average_heartrate === "number" ? Math.round(stats.average_heartrate) : null;
  const maxHR = typeof stats.max_heartrate === "number" ? Math.round(stats.max_heartrate) : null;
  const elevation = typeof stats.total_elevation_gain === "number" ? Math.round(stats.total_elevation_gain) : null;
  const avgWatts = typeof stats.average_watts === "number" ? Math.round(stats.average_watts) : null;
  const avgCadence = typeof stats.average_cadence === "number" ? Math.round(stats.average_cadence) : null;
  const sufferScore = typeof stats.suffer_score === "number" ? Math.round(stats.suffer_score) : null;

  const isGPSSport = sport !== "strength" && sport !== "mobility";
  const overflowEntries = Object.entries(stats).filter(([k, v]) => !NAMED_KEYS.has(k) && v != null);

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Back link */}
      <Link
        href={backHref}
        style={{ display: "inline-flex", alignItems: "center", fontSize: 13, color: "var(--color-ink-muted)", marginBottom: 16, textDecoration: "none" }}
      >
        {backLabel}
      </Link>

      {/* ── Hero card ── */}
      <div
        style={{
          background: accent.bg,
          border: "1px solid var(--color-border)",
          borderRadius: 16,
          padding: "20px 24px",
          marginBottom: 3,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 32, lineHeight: 1 }}>{getSportEmoji(sport)}</span>
            <h1
              style={{
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: "-0.025em",
                color: "var(--color-ink)",
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              {workoutName}
            </h1>
          </div>
          <p style={{ fontSize: 13, color: "var(--color-ink-muted)", margin: "0 0 10px" }}>{dateTime}</p>
          <span
            style={{
              display: "inline-block",
              padding: "3px 10px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
              background: isStrava
                ? "color-mix(in oklab, var(--color-clay) 15%, transparent)"
                : "var(--color-canvas-soft)",
              color: isStrava ? "var(--color-clay-deep)" : "var(--color-ink-muted)",
              border: isStrava
                ? "1px solid color-mix(in oklab, var(--color-clay) 30%, transparent)"
                : "1px solid var(--color-border)",
            }}
          >
            {isStrava ? "Strava" : "Manual Entry"}
          </span>
        </div>

        {/* Sync button — only for Strava workouts with a known activity ID */}
        {isStrava && workout.strava_activity_id && (
          <div style={{ flexShrink: 0, paddingTop: 4 }}>
            <SyncButton workoutId={workout.id} />
          </div>
        )}
      </div>

      {/* ── Stat strip ── */}
      <div
        style={{
          background: "var(--color-paper)",
          border: "1px solid var(--color-border)",
          borderTop: "none",
          borderRadius: "0 0 16px 16px",
          padding: "18px 4px",
          marginBottom: 16,
          display: "flex",
          flexWrap: "wrap",
          gap: "14px 0",
          overflow: "hidden",
        }}
      >
        <Stat label="Duration" value={durationStr} />
        {distanceStr && <Stat label="Distance" value={distanceStr} />}
        {paceStr && <Stat label={sport === "bike" ? "Avg Speed" : "Avg Pace"} value={paceStr} />}
        {avgHR != null && <Stat label="Avg HR" value={`${avgHR} bpm`} />}
        {maxHR != null && <Stat label="Max HR" value={`${maxHR} bpm`} />}
        {elevation != null && isGPSSport && <Stat label="Elevation" value={`${elevation} m`} />}
        {avgWatts != null && <Stat label="Avg Power" value={`${avgWatts} W`} />}
        {avgCadence != null && <Stat label={sport === "swim" ? "Stroke Rate" : "Cadence"} value={`${avgCadence} spm`} />}
        {sufferScore != null && <Stat label="Effort" value={String(sufferScore)} accent />}
        {/* Last item: remove the right border via a filler */}
        <div style={{ flex: 1 }} />
      </div>

      {/* ── Map ── */}
      {isGPSSport && (
        polyline ? (
          <div
            style={{
              borderRadius: 16,
              overflow: "hidden",
              border: "1px solid var(--color-border)",
              height: 380,
              marginBottom: 16,
            }}
          >
            <MapSection polyline={polyline} />
          </div>
        ) : isStrava && (
          <div
            style={{
              height: 160,
              borderRadius: 16,
              border: "1px dashed var(--color-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 10,
              color: "var(--color-ink-muted)",
              fontSize: 13,
              marginBottom: 16,
              background: "var(--color-canvas-soft)",
            }}
          >
            <span style={{ fontSize: 28 }}>📍</span>
            <div style={{ textAlign: "center" }}>
              <p style={{ margin: "0 0 2px", fontWeight: 500, color: "var(--color-ink)" }}>
                No route map yet
              </p>
              <p style={{ margin: 0, fontSize: 12 }}>
                Hit &ldquo;Sync from Strava&rdquo; above to pull the latest data
              </p>
            </div>
          </div>
        )
      )}

      {/* ── Manual entry nudge ── */}
      {showStravaConnect && (
        <div
          style={{
            padding: "14px 18px",
            background: "var(--color-canvas-soft)",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            fontSize: 13,
            color: "var(--color-ink-muted)",
            marginBottom: 16,
          }}
        >
          Logged manually —{" "}
          <Link
            href={"/athlete/settings" as Route}
            style={{ color: "var(--color-ink)", textDecoration: "underline" }}
          >
            connect Strava
          </Link>{" "}
          to unlock detailed stats and route map.
        </div>
      )}

      {/* ── Overflow stats ── */}
      {overflowEntries.length > 0 && (
        <details>
          <summary
            style={{
              cursor: "pointer",
              fontSize: 13,
              color: "var(--color-ink-muted)",
              userSelect: "none",
              marginBottom: 10,
            }}
          >
            More stats ({overflowEntries.length})
          </summary>
          <div
            style={{
              background: "var(--color-paper)",
              border: "1px solid var(--color-border)",
              borderRadius: 14,
              padding: "16px 20px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: "14px 28px",
            }}
          >
            {overflowEntries.map(([k, v]) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--color-ink-muted)",
                  }}
                >
                  {labelFor(k)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--color-ink)",
                  }}
                >
                  {String(v)}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
