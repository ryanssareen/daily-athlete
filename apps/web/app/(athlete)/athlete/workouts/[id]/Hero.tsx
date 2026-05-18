import type { Route } from "next";
import Link from "next/link";

import { formatDistance, formatDuration, formatPace, formatWorkoutDateTime } from "@/lib/format";
import { getSportLabel } from "@/lib/sport-display";

import SyncButton from "./SyncButton";

/**
 * Workout-details hero, ported from the DA2 2.0 design bundle.
 * Real-data only: every metric is gated on the underlying field being present.
 */

const SPORT_ACCENT: Record<string, { color: string; deep: string }> = {
  run:      { color: "#c45a30", deep: "#a4451f" },
  bike:     { color: "#2d6b44", deep: "#1f4d31" },
  ride:     { color: "#2d6b44", deep: "#1f4d31" },
  swim:     { color: "#1a6891", deep: "#0e4a6b" },
  strength: { color: "#4a3a80", deep: "#332766" },
  mobility: { color: "#6b4c22", deep: "#523817" },
};

function sportAccent(sport: string) {
  return SPORT_ACCENT[sport.toLowerCase()] ?? { color: "var(--color-ink-muted)", deep: "var(--color-ink)" };
}

interface HeroProps {
  workout: {
    id: string;
    started_at: string;
    sport: string;
    duration_s: number | null;
    distance_m: number | null;
    source: string;
    strava_activity_id: number | null;
    summary_stats: Record<string, unknown>;
  };
  timezone: string;
  backHref: Route;
  backLabel: string;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ArrowLeftIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(stats: Record<string, unknown>, key: string): number | null {
  const v = stats[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Headline 4-up metric definition for the current sport. */
interface BigMetric {
  label: string;
  value: string;
  unit?: string;
}

function buildHeadlineMetrics(
  workout: HeroProps["workout"]
): BigMetric[] {
  const out: BigMetric[] = [];
  const sport = workout.sport.toLowerCase();
  const stats = workout.summary_stats;

  // Distance (skip for strength / mobility)
  if (workout.distance_m != null && sport !== "strength" && sport !== "mobility") {
    const isSwim = sport === "swim";
    const value = isSwim ? String(Math.round(workout.distance_m)) : (workout.distance_m / 1000).toFixed(1);
    out.push({ label: "Distance", value, unit: isSwim ? "m" : "km" });
  }

  // Duration — split into headline number + h:mm:ss style unit so the
  // typographic weight is balanced. We keep the full formatted string
  // and use no unit (the colons read as units).
  if (workout.duration_s != null) {
    out.push({ label: "Duration", value: formatDuration(workout.duration_s) });
  }

  // Sport-specific third slot
  const avgWatts = num(stats, "average_watts");
  const isEstimatedPower = stats.device_watts === false;
  if (sport === "bike" || sport === "ride") {
    if (avgWatts != null) {
      out.push({
        label: "Avg Power",
        value: String(Math.round(avgWatts)),
        unit: isEstimatedPower ? "W est." : "W",
      });
    } else if (workout.distance_m != null && workout.duration_s != null) {
      // Fall back to avg speed
      const pace = formatPace(workout.distance_m, workout.duration_s, sport);
      if (pace != null) {
        const [paceValue, unit] = pace.split(" ");
        out.push({ label: "Avg Speed", value: paceValue ?? "—", unit });
      }
    }
  } else if (sport === "run" || sport === "swim") {
    const pace = formatPace(workout.distance_m, workout.duration_s, sport);
    if (pace != null) {
      const [paceValue, unit] = pace.split(" ");
      out.push({ label: "Avg Pace", value: paceValue ?? "—", unit });
    }
  }

  // Fourth slot — elevation for GPS sports, else cadence / suffer score
  const elev = num(stats, "total_elevation_gain");
  if (elev != null && sport !== "strength" && sport !== "mobility") {
    out.push({ label: "Elevation", value: String(Math.round(elev)), unit: "m" });
  } else {
    const suffer = num(stats, "suffer_score");
    if (suffer != null) {
      out.push({ label: "Effort", value: String(Math.round(suffer)) });
    }
  }

  return out.slice(0, 4);
}

/** Secondary 6-up stat definition — only rendered when value exists. */
interface SecStat {
  label: string;
  value: string;
  sub?: string;
}

function buildSecondaryStats(workout: HeroProps["workout"]): SecStat[] {
  const stats = workout.summary_stats;
  const sport = workout.sport.toLowerCase();
  const out: SecStat[] = [];

  const avgHR = num(stats, "average_heartrate");
  const maxHR = num(stats, "max_heartrate");
  if (avgHR != null || maxHR != null) {
    const label = avgHR != null && maxHR != null ? "Avg / Max HR" : avgHR != null ? "Avg HR" : "Max HR";
    const value =
      avgHR != null && maxHR != null
        ? `${Math.round(avgHR)} / ${Math.round(maxHR)}`
        : `${Math.round(avgHR ?? maxHR ?? 0)}`;
    out.push({ label, value, sub: "bpm" });
  }

  // Normalized Power (from /activities/{id} → weighted_average_watts)
  const np = num(stats, "weighted_average_watts");
  if (np != null) {
    out.push({ label: "Normalized Power", value: String(Math.round(np)), sub: "W" });
  }

  // TSS + IF (snapshotted at hydration time from NP + FTP)
  const tss = num(stats, "tss");
  const intensityFactor = num(stats, "intensity_factor");
  if (tss != null) {
    const sub = intensityFactor != null ? `IF ${intensityFactor.toFixed(2)}` : "Training stress";
    out.push({ label: "TSS", value: String(Math.round(tss)), sub });
  }

  // Energy (kJ)
  const kj = num(stats, "kilojoules");
  if (kj != null) {
    out.push({ label: "Energy", value: String(Math.round(kj)), sub: "kJ" });
  }

  // Max Power
  const maxW = num(stats, "max_watts");
  if (maxW != null) {
    out.push({ label: "Max Power", value: String(Math.round(maxW)), sub: "W" });
  }

  // Calories
  const calories = num(stats, "calories");
  if (calories != null) {
    out.push({ label: "Calories", value: String(Math.round(calories)) });
  }

  // Avg Power (only for non-bike sports — bike has it in the headline)
  const avgWatts = num(stats, "average_watts");
  if (avgWatts != null && sport !== "bike" && sport !== "ride") {
    out.push({ label: "Avg Power", value: String(Math.round(avgWatts)), sub: "W" });
  }

  const avgCadence = num(stats, "average_cadence");
  if (avgCadence != null) {
    const sub = sport === "swim" ? "spm" : "rpm";
    out.push({ label: sport === "swim" ? "Stroke Rate" : "Cadence", value: String(Math.round(avgCadence)), sub });
  }

  const maxSpeed = num(stats, "max_speed");
  if (maxSpeed != null) {
    // Strava max_speed is m/s; convert to km/h for parity with avg speed.
    const kmh = maxSpeed * 3.6;
    out.push({ label: "Max Speed", value: kmh.toFixed(1), sub: "km/h" });
  }

  const suffer = num(stats, "suffer_score");
  // Skip if already used as Effort in headline
  const hasElevation = num(stats, "total_elevation_gain") != null;
  if (suffer != null && hasElevation) {
    out.push({ label: "Suffer Score", value: String(Math.round(suffer)), sub: "Relative effort" });
  }

  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Hero({ workout, timezone, backHref, backLabel }: HeroProps) {
  const accent = sportAccent(workout.sport);
  const isStrava = workout.source === "strava";
  const stats = workout.summary_stats;
  const workoutName =
    (typeof stats.name === "string" && stats.name.trim().length > 0
      ? stats.name
      : getSportLabel(workout.sport));
  const dateTime = formatWorkoutDateTime(workout.started_at, timezone);

  const headline = buildHeadlineMetrics(workout);
  const secondary = buildSecondaryStats(workout);
  // Adapt grid to actual column count so dividers land correctly.
  const cols = Math.min(Math.max(secondary.length, 1), 6);

  return (
    <section className="wd-hero">
      <div className="wd-hero-topbar">
        <Link href={backHref} className="wd-back-link">
          <ArrowLeftIcon />
          <span>{backLabel}</span>
        </Link>
        {isStrava && workout.strava_activity_id && (
          <div className="wd-topbar-actions">
            <SyncButton workoutId={workout.id} />
          </div>
        )}
      </div>

      <div className="wd-hero-body">
        <div className="wd-eyebrow">
          <span className="wd-sport-chip">
            <span className="wd-sport-dot" style={{ background: accent.color }} />
            {getSportLabel(workout.sport).toUpperCase()}
          </span>
          <span className="wd-meta-dot">·</span>
          <span className={"wd-source-chip" + (isStrava ? "" : " is-manual")}>
            {isStrava ? "STRAVA" : "MANUAL"}
          </span>
          <span className="wd-meta-dot">·</span>
          <span className="wd-when-line">{dateTime}</span>
        </div>

        <h1 className="wd-hero-title">{workoutName}</h1>

        {headline.length > 0 && (
          <div className="wd-headline-grid">
            {headline.map((m) => (
              <div key={m.label} className="wd-metric-big">
                <div className="wd-metric-big-label">{m.label}</div>
                <div className="wd-metric-big-value">
                  <span className="wd-metric-big-num">{m.value}</span>
                  {m.unit && <span className="wd-metric-big-unit">{m.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {secondary.length > 0 && (
          <div className="wd-secondary-grid" style={{ ["--wd-cols" as string]: cols }}>
            {secondary.map((s) => (
              <div key={s.label} className="wd-sec-stat">
                <div className="wd-sec-stat-label">{s.label}</div>
                <div className="wd-sec-stat-value">{s.value}</div>
                {s.sub && <div className="wd-sec-stat-sub">{s.sub}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
