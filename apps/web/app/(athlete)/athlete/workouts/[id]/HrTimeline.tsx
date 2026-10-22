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

/** Per-minute average heart rate as a line + area chart. Pure SVG, no client JS. */
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

  // Break the line where a minute is missing (sensor dropout) rather than
  // drawing a straight line across the gap.
  const segments: HrMinutePoint[][] = [];
  for (const p of points) {
    const seg = segments[segments.length - 1];
    if (seg && p.minute - seg[seg.length - 1]!.minute === 1) seg.push(p);
    else segments.push([p]);
  }
  const line = (seg: HrMinutePoint[]) =>
    seg.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.minute).toFixed(1)},${y(p.avg).toFixed(1)}`).join(" ");
  const area = (seg: HrMinutePoint[]) =>
    `${line(seg)} L${x(seg[seg.length - 1]!.minute).toFixed(1)},${y(yMin).toFixed(1)} L${x(seg[0]!.minute).toFixed(1)},${y(yMin).toFixed(1)} Z`;

  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax; v += step) yTicks.push(v);

  const xStep = lastMinute <= 30 ? 5 : lastMinute <= 90 ? 15 : 30;
  const xTicks: number[] = [];
  for (let m = 0; m <= lastMinute; m += xStep) xTicks.push(m);

  return (
    <svg
      className="wd-hr-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Average heart rate for each minute of the workout"
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
      {segments.map((seg, i) => (
        <g key={i}>
          {seg.length > 1 && <path className="wd-hr-chart-area" d={area(seg)} />}
          <path className="wd-hr-chart-line" d={line(seg)} />
        </g>
      ))}
      {points.map((p) => (
        <circle key={p.minute} className="wd-hr-chart-hit" cx={x(p.minute)} cy={y(p.avg)} r={5}>
          <title>{`Minute ${p.minute + 1}: avg ${p.avg} bpm, max ${p.max} bpm`}</title>
        </circle>
      ))}
    </svg>
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
}: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  stravaActivityId: number;
}) {
  const result = await loadHrSeries({ admin, userId, stravaActivityId });
  if (result.status === "unavailable") return null;

  return (
    <section className="wd-hr">
      <header className="wd-hr-head">
        <div className="wd-section-eyebrow">Cardiovascular</div>
        <h2 className="wd-section-title">Heart rate by minute</h2>
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
