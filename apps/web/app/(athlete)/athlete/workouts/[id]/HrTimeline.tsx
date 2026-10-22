import type { HrMinutePoint } from "@/strava/hr-series";
import { loadHrSeries } from "@/strava/load-hr-series";
import type { createAdminClient } from "@/db/admin";

const W = 720;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 28, left: 40 };

function niceStep(span: number): number {
  if (span <= 40) return 10;
  if (span <= 100) return 20;
  return 25;
}

function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h${r}m`;
}

const CADENCE_COLOR = "#4a7fb5";
const PACE_COLOR = "#5b9a6e";

function fmtPace(speed: number): string {
  const secPerKm = Math.round(1000 / speed);
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, "0")}`;
}

type Series = {
  key: "hr" | "cadence" | "pace";
  label: string;
  unit: string;
  className: string;
  color: string;
  /** Value to plot (higher = further up). */
  value: (p: HrMinutePoint) => number | null;
  /** Human label for a minute's tooltip / the legend range. */
  fmt: (p: HrMinutePoint) => string;
};

/**
 * Per-minute heart rate as a line + area chart. On runs, cadence and pace are
 * overlaid; each series is scaled to its own range (the legend shows the
 * range) so all three read on one axis. Pace is inverted — faster plots higher.
 * Pure SVG, no client JS.
 */
export function HrTimelineChart({ points }: { points: HrMinutePoint[] }) {
  const lastMinute = points[points.length - 1]!.minute;
  const lo = Math.min(...points.map((p) => p.avg));
  const hi = Math.max(...points.map((p) => p.max));
  const step = niceStep(hi - lo);
  const yMin = Math.floor((lo - 5) / step) * step;
  const yMax = Math.ceil((hi + 5) / step) * step;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (minute: number) => PAD.left + (lastMinute === 0 ? 0 : (minute / lastMinute) * innerW);
  const y = (bpm: number) => PAD.top + (1 - (bpm - yMin) / (yMax - yMin)) * innerH;

  const hasCadence = points.some((p) => p.cadence != null);
  const hasPace = points.some((p) => p.speed != null);

  const series: Series[] = [
    { key: "hr", label: "Heart rate", unit: "bpm", className: "wd-hr-chart-line", color: "#d97e3a", value: (p) => p.avg, fmt: (p) => `${p.avg} bpm` },
  ];
  if (hasCadence) {
    series.push({ key: "cadence", label: "Cadence", unit: "spm", className: "wd-hr-chart-line", color: CADENCE_COLOR, value: (p) => p.cadence ?? null, fmt: (p) => `${p.cadence} spm` });
  }
  if (hasPace) {
    series.push({ key: "pace", label: "Pace", unit: "/km", className: "wd-hr-chart-line", color: PACE_COLOR, value: (p) => (p.speed != null ? p.speed : null), fmt: (p) => `${fmtPace(p.speed!)} /km` });
  }

  // Map a series to chart-y through its own min/max (HR uses the labelled axis).
  const scaler = (s: Series): ((v: number) => number) => {
    if (s.key === "hr") return y;
    const vals = points.map(s.value).filter((v): v is number => v != null);
    const sLo = Math.min(...vals);
    const sHi = Math.max(...vals);
    const span = sHi - sLo || 1;
    return (v) => PAD.top + (1 - (v - sLo) / span) * innerH * 0.9 + innerH * 0.05;
  };

  const lineFor = (s: Series, to: (v: number) => number) => {
    // Break the line where a minute is missing (sensor dropout) rather than
    // drawing a straight line across the gap.
    const segs: { minute: number; v: number }[][] = [];
    for (const p of points) {
      const v = s.value(p);
      if (v == null) continue;
      const seg = segs[segs.length - 1];
      if (seg && p.minute - seg[seg.length - 1]!.minute === 1) seg.push({ minute: p.minute, v });
      else segs.push([{ minute: p.minute, v }]);
    }
    return segs.map((seg) => ({
      line: seg.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.minute).toFixed(1)},${to(p.v).toFixed(1)}`).join(" "),
      first: seg[0]!.minute,
      last: seg[seg.length - 1]!.minute,
      len: seg.length,
    }));
  };

  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax; v += step) yTicks.push(v);

  const xStep = lastMinute <= 30 ? 5 : lastMinute <= 90 ? 15 : 30;
  const xTicks: number[] = [];
  for (let m = 0; m <= lastMinute; m += xStep) xTicks.push(m);

  const colW = lastMinute === 0 ? innerW : innerW / lastMinute;

  return (
    <>
      {series.length > 1 && (
        <ul className="wd-hr-legend">
          {series.map((s) => {
            const vals = points.map(s.value).filter((v): v is number => v != null);
            const sLo = Math.min(...vals);
            const sHi = Math.max(...vals);
            const range =
              s.key === "pace"
                ? `${fmtPace(sHi)}–${fmtPace(sLo)} /km`
                : `${Math.round(sLo)}–${Math.round(sHi)} ${s.unit}`;
            return (
              <li key={s.key} className="wd-hr-legend-item">
                <span className="wd-hr-legend-swatch" style={{ background: s.color }} />
                {s.label} <span className="wd-hr-legend-range">{range}</span>
              </li>
            );
          })}
        </ul>
      )}
      <svg
        className="wd-hr-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={
          series.length > 1
            ? "Heart rate, cadence and pace for each minute of the run"
            : "Average heart rate for each minute of the workout"
        }
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line className="wd-hr-chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="wd-hr-chart-label" x={PAD.left - 6} y={y(v) + 3} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {xTicks.map((m) => (
          <text key={m} className="wd-hr-chart-label" x={x(m)} y={H - 8} textAnchor="middle">
            {fmtMinutes(m)}
          </text>
        ))}
        {series.map((s) => {
          const to = scaler(s);
          return (
            <g key={s.key}>
              {lineFor(s, to).map((seg, i) => (
                <g key={i}>
                  {s.key === "hr" && seg.len > 1 && (
                    <path
                      className="wd-hr-chart-area"
                      d={`${seg.line} L${x(seg.last).toFixed(1)},${y(yMin).toFixed(1)} L${x(seg.first).toFixed(1)},${y(yMin).toFixed(1)} Z`}
                    />
                  )}
                  <path className={s.className} d={seg.line} style={{ stroke: s.color }} />
                </g>
              ))}
            </g>
          );
        })}
        {points.map((p) => (
          <rect
            key={p.minute}
            className="wd-hr-chart-col"
            x={x(p.minute) - colW / 2}
            y={PAD.top}
            width={colW}
            height={innerH}
          >
            <title>
              {`Minute ${p.minute + 1}: ${series
                .map((s) => (s.value(p) == null ? null : `${s.label.toLowerCase()} ${s.fmt(p)}`))
                .filter(Boolean)
                .join(", ")}${series.length === 1 ? `, max ${p.max} bpm` : ""}`}
            </title>
          </rect>
        ))}
      </svg>
    </>
  );
}

export function HrTimelineSkeleton() {
  return (
    <section className="wd-hr">
      <header className="wd-hr-head">
        <div className="wd-section-eyebrow">Cardiovascular</div>
        <h2 className="wd-section-title">Heart rate by minute</h2>
      </header>
      <div className="wd-hr-chart-skeleton" aria-busy="true" />
    </section>
  );
}

/**
 * Async server component: fetches the HR stream from Strava while the rest of
 * the page streams in, reduces it to per-minute points in memory and renders
 * the chart. Nothing is stored. Renders nothing when Strava has no HR stream.
 */
export async function HrTimelineSection({
  admin,
  userId,
  stravaActivityId,
  isRun = false,
}: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  stravaActivityId: number;
  isRun?: boolean;
}) {
  const result = await loadHrSeries({ admin, userId, stravaActivityId, isRun });
  if (result.status === "unavailable") return null;

  return (
    <section className="wd-hr">
      <header className="wd-hr-head">
        <div className="wd-section-eyebrow">Cardiovascular</div>
        <h2 className="wd-section-title">{isRun ? "Heart rate, cadence and pace" : "Heart rate by minute"}</h2>
      </header>
      {result.status === "ok" ? (
        <HrTimelineChart points={result.points} />
      ) : (
        <p className="wd-hr-empty">
          {result.status === "rate_limited"
            ? "Strava is limiting requests right now. Reload in a few minutes to see the minute-by-minute chart."
            : result.status === "reauth_required"
              ? "Reconnect Strava in Settings to see the minute-by-minute chart."
              : "Couldn’t load the minute-by-minute chart from Strava. Try again shortly."}
        </p>
      )}
    </section>
  );
}
