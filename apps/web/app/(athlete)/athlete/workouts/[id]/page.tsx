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

// ---------- Stat helpers -----------------------------------------------------

/** Convert a summary_stats key to a human-readable label. */
function labelFor(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        className="eyebrow"
        style={{ fontSize: 10, letterSpacing: "0.08em" }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 16,
          fontWeight: 600,
          color: "var(--color-ink)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 16,
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {children}
    </div>
  );
}

// ---------- Keys that are shown in named sections (excluded from overflow) ---

const NAMED_KEYS = new Set([
  "average_speed",
  "max_speed",
  "average_heartrate",
  "max_heartrate",
  "average_watts",
  "max_watts",
  "total_elevation_gain",
  "suffer_score",
  "average_cadence",
  "name",
]);

// ---------- Page -------------------------------------------------------------

export default async function AthleteWorkoutDetailPage({
  params,
  searchParams,
}: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const from = sp.from;
  const backHref = backHrefFor(from);
  const backLabel = backLabelFor(from);

  const [session, supabase] = await Promise.all([
    getUserWithRoles(),
    createClient(),
  ]);
  if (!session) redirect("/sign-in");

  const workout = await getWorkoutById(supabase, session.user.id, id);
  if (!workout) redirect(backHref);

  const stats = workout.summary_stats;
  const isStrava = workout.source === "strava";
  const sport = workout.sport;

  // Strava nudge: only for manual workouts where athlete hasn't connected yet
  let showStravaConnect = false;
  if (!isStrava) {
    const admin = createAdminClient();
    showStravaConnect = !(await hasStravaToken(admin, session.user.id));
  }

  // Derived display values
  const workoutName =
    (stats.name as string | null) ?? getSportLabel(sport);
  const dateTime = formatWorkoutDateTime(workout.started_at, session.timezone);
  const durationStr = formatDuration(workout.duration_s);
  const distanceStr =
    sport !== "strength"
      ? formatDistance(workout.distance_m, sport)
      : null;
  const paceStr = formatPace(workout.distance_m, workout.duration_s, sport);

  // HR
  const avgHR = stats.average_heartrate as number | null | undefined;
  const maxHR = stats.max_heartrate as number | null | undefined;
  const showHR =
    isStrava && avgHR != null;

  // Elevation
  const elevation = stats.total_elevation_gain as number | null | undefined;
  const showElevation =
    isStrava && sport !== "strength" && elevation != null;

  // Relative effort
  const sufferScore = stats.suffer_score as number | null | undefined;
  const showEffort = isStrava && sufferScore != null;

  // Power (bike only)
  const avgWatts = stats.average_watts as number | null | undefined;
  const showPower = isStrava && sport === "bike" && avgWatts != null;

  // Stroke rate (swim only)
  const avgCadence = stats.average_cadence as number | null | undefined;
  const showStrokeRate = isStrava && sport === "swim" && avgCadence != null;

  // Source badge
  const sourceBadgeStyle: React.CSSProperties = isStrava
    ? {
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        fontFamily: "var(--font-mono)",
        background:
          "color-mix(in oklab, var(--color-clay) 15%, transparent)",
        color: "var(--color-clay-deep)",
        border:
          "1px solid color-mix(in oklab, var(--color-clay) 30%, transparent)",
      }
    : {
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        fontFamily: "var(--font-mono)",
        background: "var(--color-canvas-soft)",
        color: "var(--color-ink-muted)",
        border: "1px solid var(--color-border)",
      };

  // Overflow keys: summary_stats not handled by a named section
  const overflowEntries = Object.entries(stats).filter(
    ([k, v]) => !NAMED_KEYS.has(k) && v != null
  );

  return (
    <div style={{ maxWidth: 640 }}>
      {/* Back link */}
      <Link
        href={backHref}
        style={{
          display: "inline-flex",
          alignItems: "center",
          fontSize: 13,
          color: "var(--color-ink-muted)",
          marginBottom: 24,
          textDecoration: "none",
        }}
      >
        {backLabel}
      </Link>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 4,
          }}
        >
          <span style={{ fontSize: 28, lineHeight: 1 }}>
            {getSportEmoji(sport)}
          </span>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "var(--color-ink)",
              margin: 0,
            }}
          >
            {workoutName}
          </h1>
        </div>
        <p
          style={{
            fontSize: 13,
            color: "var(--color-ink-muted)",
            marginBottom: 10,
          }}
        >
          {dateTime}
        </p>
        <span style={sourceBadgeStyle}>
          {isStrava ? "Strava" : "Manual Entry"}
        </span>
      </div>

      {/* Primary stats row */}
      <SectionCard>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          <StatBlock label="Duration" value={durationStr} />
          {distanceStr != null && (
            <StatBlock label="Distance" value={distanceStr} />
          )}
          {paceStr != null && (
            <StatBlock
              label={sport === "bike" ? "Speed" : "Pace"}
              value={paceStr}
            />
          )}
        </div>
      </SectionCard>

      {/* HR section */}
      {showHR && (
        <div style={{ marginTop: 16 }}>
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            Heart Rate
          </p>
          <SectionCard>
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
              <StatBlock label="Avg HR" value={`${Math.round(avgHR!)} bpm`} />
              {maxHR != null && (
                <StatBlock
                  label="Max HR"
                  value={`${Math.round(maxHR)} bpm`}
                />
              )}
            </div>
          </SectionCard>
        </div>
      )}

      {/* Power section (bike only) */}
      {showPower && (
        <div style={{ marginTop: 16 }}>
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            Power
          </p>
          <SectionCard>
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
              <StatBlock
                label="Avg Power"
                value={`${Math.round(avgWatts!)} W`}
              />
            </div>
          </SectionCard>
        </div>
      )}

      {/* Elevation section */}
      {showElevation && (
        <div style={{ marginTop: 16 }}>
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            Elevation
          </p>
          <SectionCard>
            <StatBlock
              label="Gain"
              value={`${Math.round(elevation!)} m`}
            />
          </SectionCard>
        </div>
      )}

      {/* Stroke rate (swim only) */}
      {showStrokeRate && (
        <div style={{ marginTop: 16 }}>
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            Stroke Rate
          </p>
          <SectionCard>
            <StatBlock
              label="Avg Stroke Rate"
              value={`${Math.round(avgCadence!)} spm`}
            />
          </SectionCard>
        </div>
      )}

      {/* Relative effort */}
      {showEffort && (
        <div style={{ marginTop: 16 }}>
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            Effort
          </p>
          <SectionCard>
            <StatBlock
              label="Relative Effort"
              value={String(Math.round(sufferScore!))}
            />
          </SectionCard>
        </div>
      )}

      {/* Overflow: any other summary_stats keys */}
      {overflowEntries.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: 13,
              color: "var(--color-ink-muted)",
              userSelect: "none",
              marginBottom: 8,
            }}
          >
            More stats
          </summary>
          <SectionCard>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: "16px 32px",
              }}
            >
              {overflowEntries.map(([k, v]) => (
                <StatBlock
                  key={k}
                  label={labelFor(k)}
                  value={String(v)}
                />
              ))}
            </div>
          </SectionCard>
        </details>
      )}

      {/* Manual workout: Strava connect nudge */}
      {showStravaConnect && (
        <div
          style={{
            marginTop: 24,
            padding: "16px 20px",
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
          for detailed stats.
        </div>
      )}
    </div>
  );
}
