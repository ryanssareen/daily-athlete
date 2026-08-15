import { SPORT_ACCENT, fmtClockShort } from "./utils";
import type { PlannedWorkoutData } from "./types";

function VsPill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  if (pct === 0) return <span className="vs-pill vs-neutral">≈ last time</span>;
  const isUp = pct > 0;
  return (
    <span className={"vs-pill " + (isUp ? "vs-up" : "vs-down")}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {isUp ? (
          <>
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </>
        ) : (
          <>
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
          </>
        )}
      </svg>
      {Math.abs(pct)}% vs last
    </span>
  );
}

function MetricBig({ label, value, unit, vs }: { label: string; value: string; unit?: string; vs?: number }) {
  return (
    <div className="metric-big">
      <div className="metric-big-label">{label}</div>
      <div className="metric-big-value">
        <span className="metric-big-num">{value}</span>
        {unit && <span className="metric-big-unit">{unit}</span>}
      </div>
      {vs != null && <VsPill value={vs} />}
    </div>
  );
}

export function PlannedHero({ data }: { data: PlannedWorkoutData }) {
  const accent = SPORT_ACCENT[data.sport];
  const totalSec = data.segments.reduce((s, seg) => s + seg.durSec, 0);

  return (
    <section
      className="hero"
      style={{ "--accent": accent.color, "--accent-deep": accent.deep, "--accent-soft": accent.soft } as React.CSSProperties}
    >
      <div className="hero-topbar">
        <a href="/athlete/calendar" className="back-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span>Calendar</span>
        </a>
        <div className="topbar-actions">
          <button className="ghost-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 3h5v5" />
              <path d="M4 20 21 3" />
              <path d="M21 16v5h-5" />
              <path d="M15 15l6 6" />
              <path d="M4 4l5 5" />
            </svg>
            Swap workout
          </button>
        </div>
      </div>

      <div className="hero-body">
        <div className="hero-eyebrow">
          <span className="sport-chip">
            <span className="sport-dot" style={{ background: accent.color }} />
            {data.sport.toUpperCase()}
          </span>
          <span className="meta-dot">·</span>
          <span className="status-chip planned">PLANNED</span>
          <span className="meta-dot">·</span>
          <span className="when-line">
            {data.scheduledDateLabel} · {data.weekLabel}
          </span>
        </div>

        <h1 className="hero-title">{data.name}</h1>

        <div className="hero-meta-row">
          <span className="meta-pill">{data.type}</span>
          <span className="meta-pill">FTP {data.ftp} W</span>
          <span className="meta-pill">≈ {data.targetDistanceKm} km</span>
        </div>

        <div className="headline-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <MetricBig label="Duration" value={fmtClockShort(totalSec)} vs={data.vs.duration} />
          <MetricBig label="Est. training stress" value="78" unit="TSS" vs={data.vs.tss} />
          <MetricBig label="Primary zone" value="Z4" unit="threshold" />
        </div>
      </div>
    </section>
  );
}
