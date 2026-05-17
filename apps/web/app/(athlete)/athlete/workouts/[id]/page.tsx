import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { getWorkoutById } from "@/db/workouts";
import { hasStravaToken } from "@/db/strava-tokens";
import { getSportEmoji, getSportLabel } from "@/lib/sport-display";
import {
  formatDuration,
  formatDistance,
  formatPace,
  formatWorkoutDateTime,
} from "@/lib/format";
import MapSection from "./MapSection";

// ---------- Types ------------------------------------------------------------

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
};

// ---------- Back nav ---------------------------------------------------------

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

// ---------- UI atoms ---------------------------------------------------------

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-ink-muted)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 18,
          fontWeight: 600,
          color: "var(--color-ink)",
          lineHeight: 1,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function StatCard({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "16px 20px",
      }}
    >
      {title && (
        <p
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-ink-muted)",
            marginBottom: 12,
          }}
        >
          {title}
        </p>
      )}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {children}
      </div>
    </div>
  );
}

// Keys rendered in named sections — excluded from the overflow drawer
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

function labelFor(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- Page -------------------------------------------------------------

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

  let showStravaConnect = false;
  if (!isStrava) {
    const admin = createAdminClient();
    showStravaConnect = !(await hasStravaToken(admin, session.user.id));
  }

  // Derived values
  const workoutName = (stats.name as string | null) ?? getSportLabel(sport);
  const dateTime = formatWorkoutDateTime(workout.started_at, session.timezone);
  const durationStr = formatDuration(workout.duration_s);
  const distanceStr = sport !== "strength" ? formatDistance(workout.distance_m, sport) : null;
  const paceStr = formatPace(workout.distance_m, workout.duration_s, sport);
  const polyline = typeof stats.polyline === "string" ? stats.polyline : null;

  // HR
  const avgHR = stats.average_heartrate as number | null | undefined;
  const maxHR = stats.max_heartrate as number | null | undefined;
  const showHR = isStrava && avgHR != null;

  // Elevation
  const elevation = stats.total_elevation_gain as number | null | undefined;
  const showElevation = isStrava && sport !== "strength" && elevation != null;

  // Power
  const avgWatts = stats.average_watts as number | null | undefined;
  const showPower = isStrava && sport === "bike" && avgWatts != null;

  // Stroke rate
  const avgCadence = stats.average_cadence as number | null | undefined;
  const showStrokeRate = isStrava && sport === "swim" && avgCadence != null;

  // Effort
  const sufferScore = stats.suffer_score as number | null | undefined;
  const showEffort = isStrava && sufferScore != null;

  // Overflow
  const overflowEntries = Object.entries(stats).filter(
    ([k, v]) => !NAMED_KEYS.has(k) && v != null
  );

  const sourceBadgeStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 500,
    fontFamily: "var(--font-mono)",
    ...(isStrava
      ? {
          background: "color-mix(in oklab, var(--color-clay) 15%, transparent)",
          color: "var(--color-clay-deep)",
          border: "1px solid color-mix(in oklab, var(--color-clay) 30%, transparent)",
        }
      : {
          background: "var(--color-canvas-soft)",
          color: "var(--color-ink-muted)",
          border: "1px solid var(--color-border)",
        }),
  };

  const hasRightStats = showHR || showPower || showElevation || showStrokeRate || showEffort;

  return (
    <div style={{ maxWidth: 960 }}>
      {/* Back link */}
      <Link
        href={backHref}
        style={{
          display: "inline-flex",
          alignItems: "center",
          fontSize: 13,
          color: "var(--color-ink-muted)",
          marginBottom: 20,
          textDecoration: "none",
        }}
      >
        {backLabel}
      </Link>

      {/* Two-column layout */}
      <div className="workout-detail-grid">
        {/* ── Left column: identity + primary stats ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Header */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 30, lineHeight: 1 }}>{getSportEmoji(sport)}</span>
              <h1
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "var(--color-ink)",
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                {workoutName}
              </h1>
            </div>
            <p style={{ fontSize: 13, color: "var(--color-ink-muted)", marginBottom: 8 }}>
              {dateTime}
            </p>
            <span style={sourceBadgeStyle}>{isStrava ? "Strava" : "Manual Entry"}</span>
          </div>

          {/* Primary stats */}
          <StatCard title="Summary">
            <StatBlock label="Duration" value={durationStr} />
            {distanceStr != null && <StatBlock label="Distance" value={distanceStr} />}
            {paceStr != null && (
              <StatBlock label={sport === "bike" ? "Speed" : "Pace"} value={paceStr} />
            )}
          </StatCard>

          {/* Strava connect nudge */}
          {showStravaConnect && (
            <div
              style={{
                padding: "14px 18px",
                background: "var(--color-canvas-soft)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                fontSize: 13,
                color: "var(--color-ink-muted)",
              }}
            >
              Logged manually —{" "}
              <Link
                href={"/athlete/settings" as Route}
                style={{ color: "var(--color-ink)", textDecoration: "underline" }}
              >
                connect Strava
              </Link>{" "}
              for detailed stats and route map.
            </div>
          )}
        </div>

        {/* ── Right column: map + detail stats ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Route map */}
          {polyline ? (
            <div
              style={{
                borderRadius: 14,
                overflow: "hidden",
                border: "1px solid var(--color-border)",
                height: 320,
              }}
            >
              <MapSection polyline={polyline} />
            </div>
          ) : (
            isStrava && sport !== "strength" && sport !== "mobility" && (
              <div
                style={{
                  height: 200,
                  borderRadius: 14,
                  border: "1px dashed var(--color-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  gap: 6,
                  color: "var(--color-ink-muted)",
                  fontSize: 13,
                }}
              >
                <span style={{ fontSize: 24 }}>📍</span>
                <span>No route data — re-sync to load map</span>
              </div>
            )
          )}

          {/* Detail stats grid */}
          {hasRightStats && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 12,
              }}
            >
              {showHR && (
                <StatCard title="Heart Rate">
                  <StatBlock label="Avg" value={`${Math.round(avgHR!)} bpm`} />
                  {maxHR != null && (
                    <StatBlock label="Max" value={`${Math.round(maxHR)} bpm`} />
                  )}
                </StatCard>
              )}
              {showPower && (
                <StatCard title="Power">
                  <StatBlock label="Avg" value={`${Math.round(avgWatts!)} W`} />
                </StatCard>
              )}
              {showElevation && (
                <StatCard title="Elevation">
                  <StatBlock label="Gain" value={`${Math.round(elevation!)} m`} />
                </StatCard>
              )}
              {showStrokeRate && (
                <StatCard title="Stroke Rate">
                  <StatBlock label="Avg" value={`${Math.round(avgCadence!)} spm`} />
                </StatCard>
              )}
              {showEffort && (
                <StatCard title="Effort">
                  <StatBlock label="Relative" value={String(Math.round(sufferScore!))} />
                </StatCard>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Overflow stats — full width below */}
      {overflowEntries.length > 0 && (
        <details style={{ marginTop: 24 }}>
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
              <StatBlock key={k} label={labelFor(k)} value={String(v)} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
