"use client";

import { useState } from "react";

import { formatPace } from "@/lib/format";

// Strava-computed lap summaries rendered as a clickable table.
// Each row expands inline to show distance / pace / cadence / avg speed.
// Lap "kind" (work / recover / warm-up / cool-down) is inferred from
// the relative average_watts of the lap vs. the workout's median —
// purely cosmetic, drives the left-edge colour strip. When power data
// is absent (run / swim), kinds are not displayed and all rows are
// uniform.
//
// Data comes from `summary_stats.laps`, an array Strava returns from
// `GET /activities/{id}/laps`.

interface Lap {
  lap_index: number;
  name?: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  average_watts?: number;
  total_elevation_gain?: number;
}

interface Props {
  laps: unknown[];
  sport: string;
}

function isLap(value: unknown): value is Lap {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.lap_index === "number" &&
    typeof v.elapsed_time === "number" &&
    typeof v.moving_time === "number" &&
    typeof v.distance === "number"
  );
}

function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0 && sec > 0) return `${m}m ${sec}s`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

function fmtDistanceKm(meters: number): string {
  return (meters / 1000).toFixed(2);
}

function fmtPace(meters: number, seconds: number, sport: string): string {
  // Delegate to the shared formatter; just provide the "—" fallback the
  // existing call sites in this component expect when data is missing.
  return formatPace(meters, seconds, sport) ?? "—";
}

/** Crude lap-kind classifier — only meaningful when power data exists. */
function classifyLapKinds(laps: Lap[]): Array<"work" | "recover" | "warmup" | "cooldown" | "steady"> {
  const withPower = laps.filter((l) => l.average_watts != null);
  if (withPower.length === 0) {
    return laps.map(() => "steady");
  }
  // Median power as the work/recover threshold
  const sorted = withPower.map((l) => l.average_watts!).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return laps.map((lap, i) => {
    if (i === 0) return "warmup";
    if (i === laps.length - 1) return "cooldown";
    if (lap.average_watts == null) return "steady";
    return lap.average_watts >= median * 1.15 ? "work" : "recover";
  });
}

export function LapSplits({ laps: lapsRaw, sport }: Props) {
  const laps = lapsRaw.filter(isLap);
  const [expanded, setExpanded] = useState<number | null>(null);

  if (laps.length === 0) return null;

  const kinds = classifyLapKinds(laps);
  const sportNorm = sport.toLowerCase();

  return (
    <section className="wd-laps">
      <header className="wd-laps-head">
        <div>
          <div className="wd-section-eyebrow">Splits</div>
          <h2 className="wd-section-title">Every segment</h2>
        </div>
        <span className="wd-laps-count">{laps.length} {laps.length === 1 ? "segment" : "segments"}</span>
      </header>
      <div className="wd-laps-table">
        <div className="wd-laps-row wd-laps-row-head" role="row">
          <span>#</span>
          <span>Segment</span>
          <span>Duration</span>
          <span>Distance</span>
          <span>{sportNorm === "bike" || sportNorm === "ride" ? "Avg Speed" : "Avg Pace"}</span>
          <span>Avg HR</span>
        </div>
        {laps.map((lap, i) => {
          const kind = kinds[i] ?? "steady";
          const isOpen = expanded === lap.lap_index;
          const label = lap.name ?? `Lap ${lap.lap_index}`;
          return (
            <div key={lap.lap_index}>
              <button
                type="button"
                className={"wd-laps-row" + (isOpen ? " is-open" : "") + (kind === "work" ? " is-work" : "")}
                onClick={() => setExpanded(isOpen ? null : lap.lap_index)}
              >
                <span className="wd-lap-num">{lap.lap_index}</span>
                <span className="wd-lap-label">
                  <span className={"wd-lap-kind kind-" + kind} />
                  {label}
                </span>
                <span className="wd-lap-val">{fmtDuration(lap.elapsed_time)}</span>
                <span className="wd-lap-val">{fmtDistanceKm(lap.distance)} km</span>
                <span className="wd-lap-val">{fmtPace(lap.distance, lap.elapsed_time, sportNorm)}</span>
                <span className="wd-lap-val">{lap.average_heartrate != null ? `${Math.round(lap.average_heartrate)} bpm` : "—"}</span>
              </button>
              {isOpen && (
                <div className="wd-lap-expand">
                  <div className="wd-lap-expand-grid">
                    <Detail k="Moving time" v={fmtDuration(lap.moving_time)} />
                    <Detail k="Avg power" v={lap.average_watts != null ? `${Math.round(lap.average_watts)} W` : "—"} />
                    <Detail k="Max HR" v={lap.max_heartrate != null ? `${Math.round(lap.max_heartrate)} bpm` : "—"} />
                    <Detail k="Cadence" v={lap.average_cadence != null ? `${Math.round(lap.average_cadence)}` : "—"} />
                    <Detail k="Elevation gain" v={lap.total_elevation_gain != null ? `${Math.round(lap.total_elevation_gain)} m` : "—"} />
                    <Detail k="Max speed" v={lap.max_speed != null ? `${(lap.max_speed * 3.6).toFixed(1)} km/h` : "—"} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div className="wd-lap-detail">
      <span className="wd-lap-detail-k">{k}</span>
      <span className="wd-lap-detail-v">{v}</span>
    </div>
  );
}
