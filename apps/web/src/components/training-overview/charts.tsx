import type { LoadDayPoint } from "@/training-load/load-series";
import type { WeeklyBucket } from "@/training-overview/calc";

import { sportColor, sportLabel } from "./sport-colors";

const W = 640;
const H = 220;
const M = { t: 12, r: 12, b: 26, l: 36 };
const axisText = { fontSize: 11, fill: "var(--color-ink-subtle)" } as const;

function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function niceMax(n: number): number {
  if (n <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(n));
  const step = [1, 2, 5, 10].find((s) => s * pow >= n) ?? 10;
  return step * pow;
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul
      style={{
        listStyle: "none",
        padding: 0,
        margin: "0 0 8px",
        display: "flex",
        flexWrap: "wrap",
        gap: 14,
        fontSize: 12,
        color: "var(--color-ink-muted)",
      }}
    >
      {items.map((i) => (
        <li key={i.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export function FormChart({ series }: { series: LoadDayPoint[] }) {
  if (series.length < 2) return <ChartEmpty />;
  const innerW = W - M.l - M.r;
  const innerH = H - M.t - M.b;
  const values = series.flatMap((p) => [p.ctl, p.atl, p.tsb]);
  const max = niceMax(Math.max(...values, 0));
  const min = Math.min(...values, 0);
  const lo = min < 0 ? -niceMax(-min) : 0;
  const x = (i: number) => M.l + (i / (series.length - 1)) * innerW;
  const y = (v: number) => M.t + (1 - (v - lo) / (max - lo)) * innerH;
  const path = (pick: (p: LoadDayPoint) => number) =>
    series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join("");
  const ticks = [lo, lo + (max - lo) / 2, max];
  const labelEvery = Math.ceil(series.length / 6);
  const lines = [
    { key: "ctl", label: "Fitness (CTL)", color: "var(--color-pine)", pick: (p: LoadDayPoint) => p.ctl },
    { key: "atl", label: "Fatigue (ATL)", color: "var(--color-clay)", pick: (p: LoadDayPoint) => p.atl },
    { key: "tsb", label: "Form (TSB)", color: "var(--color-ink-subtle)", pick: (p: LoadDayPoint) => p.tsb },
  ];
  return (
    <div>
      <Legend items={lines.map((l) => ({ label: l.label, color: l.color }))} />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Fitness, fatigue and form over the last 28 days"
        style={{ display: "block" }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--color-border)" />
            <text x={M.l - 6} y={y(t) + 4} textAnchor="end" {...axisText}>
              {Math.round(t)}
            </text>
          </g>
        ))}
        {series.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.date} x={x(i)} y={H - 6} textAnchor="middle" {...axisText}>
              {shortDay(p.date)}
            </text>
          ) : null,
        )}
        {lines.map((l) => (
          <path
            key={l.key}
            d={path(l.pick)}
            fill="none"
            stroke={l.color}
            strokeWidth={l.key === "tsb" ? 1.5 : 2.25}
            strokeDasharray={l.key === "tsb" ? "4 3" : undefined}
            strokeLinejoin="round"
          />
        ))}
        {series.map((p, i) => (
          <circle key={p.date} cx={x(i)} cy={y(p.ctl)} r={8} fill="transparent">
            <title>{`${shortDay(p.date)} · CTL ${p.ctl.toFixed(1)} · ATL ${p.atl.toFixed(1)} · TSB ${p.tsb.toFixed(1)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

export function WeeklyVolumeChart({ weekly }: { weekly: WeeklyBucket[] }) {
  const sports = [...new Set(weekly.flatMap((w) => Object.keys(w.bySport)))];
  const max = niceMax(Math.max(...weekly.map((w) => w.totalH), 0));
  if (sports.length === 0) return <ChartEmpty />;
  const innerW = W - M.l - M.r;
  const innerH = H - M.t - M.b;
  const slot = innerW / weekly.length;
  const bw = Math.min(34, slot * 0.62);
  const y = (v: number) => M.t + (1 - v / max) * innerH;
  return (
    <div>
      <Legend items={sports.map((s) => ({ label: sportLabel(s), color: sportColor(s) }))} />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Weekly training hours by sport"
        style={{ display: "block" }}
      >
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--color-border)" />
            <text x={M.l - 6} y={y(t) + 4} textAnchor="end" {...axisText}>
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          </g>
        ))}
        {weekly.map((w, i) => {
          const cx = M.l + slot * i + slot / 2;
          let acc = 0;
          return (
            <g key={w.weekStart}>
              <title>
                {`Week of ${shortDay(w.weekStart)} · ${w.totalH.toFixed(1)} h` +
                  sports
                    .filter((s) => (w.bySport[s] ?? 0) > 0)
                    .map((s) => ` · ${sportLabel(s)} ${w.bySport[s].toFixed(1)} h`)
                    .join("")}
              </title>
              {sports.map((s) => {
                const h = w.bySport[s] ?? 0;
                if (h <= 0) return null;
                const top = y(acc + h);
                const height = y(acc) - top;
                acc += h;
                return (
                  <rect key={s} x={cx - bw / 2} y={top} width={bw} height={height} rx={2} fill={sportColor(s)} />
                );
              })}
              <text x={cx} y={H - 6} textAnchor="middle" {...axisText}>
                {i % 2 === (weekly.length - 1) % 2 ? shortDay(w.weekStart) : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ChartEmpty() {
  return (
    <p style={{ margin: 0, padding: "40px 0", textAlign: "center", fontSize: 13, color: "var(--color-ink-muted)" }}>
      Not enough training logged yet.
    </p>
  );
}
