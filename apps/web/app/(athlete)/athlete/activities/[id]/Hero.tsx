import type { WorkoutData } from "./types";
import { SPORT_ACCENT, fmtDuration, fmtDistance } from "./utils";

function VsPill({ value, inverse }: { value: number; inverse?: boolean }) {
  const pct = Math.round(value * 100);
  if (pct === 0) return <span className="vs-pill vs-neutral">≈ avg</span>;
  const isUp = pct > 0;
  const cls = isUp ? (inverse ? "vs-down" : "vs-up") : (inverse ? "vs-up" : "vs-down");
  return (
    <span className={"vs-pill " + cls}>
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
      {Math.abs(pct)}%
    </span>
  );
}

function MetricBig({ label, value, unit, vs, inverse }: { label: string; value: string | number; unit?: string; vs?: number; inverse?: boolean }) {
  return (
    <div className="metric-big">
      <div className="metric-big-label">{label}</div>
      <div className="metric-big-value">
        <span className="metric-big-num">{value}</span>
        {unit && <span className="metric-big-unit">{unit}</span>}
      </div>
      {vs != null && <VsPill value={vs} inverse={inverse} />}
    </div>
  );
}

export function WorkoutHero({ data }: { data: WorkoutData }) {
  const accent = SPORT_ACCENT[data.sport];

  return (
    <section className="hero" style={{ "--accent": accent.color, "--accent-deep": accent.deep, "--accent-soft": accent.soft } as React.CSSProperties}>
      <div className="hero-topbar">
        <a href="/athlete/activities" className="back-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span>Activities</span>
        </a>
        <div className="topbar-actions">
          <button className="ghost-btn" title="Share workout">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            Share
          </button>
          <button className="ghost-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Sync from Strava
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
          <span className="source-chip">{data.source.toUpperCase()}</span>
          <span className="meta-dot">·</span>
          <span className="when-line">
            {data.startedAt} · {data.location}
          </span>
        </div>

        <h1 className="hero-title">{data.name}</h1>

        <div className="hero-meta-row">
          <span className="meta-pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.5 19a4.5 4.5 0 1 0 0-9h-1.8A7 7 0 1 0 4 16.9" />
            </svg>
            {data.weather.tempF}°F · {data.weather.condition}
          </span>
          <span className="meta-pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
            </svg>
            {data.weather.windMph} mph {data.weather.windDir}
          </span>
          <span className="meta-pill rpe-pill">
            <span className="rpe-num">{data.rpe}</span>
            <span>/ 10 RPE</span>
          </span>
        </div>

        <div className="headline-grid">
          <MetricBig label="Duration" value={fmtDuration(data.duration)} vs={data.vsAvg.duration} />
          <MetricBig label="Distance" value={fmtDistance(data.distanceM)} unit="km" />
          <MetricBig label="Elevation" value={data.elevationGain} unit="m" vs={data.vsAvg.elevationGain} />
          <MetricBig label="Avg Power" value={data.avgPower} unit="W" vs={data.vsAvg.avgPower} />
          <MetricBig label="Normalized Power" value={data.normalizedPower} unit="W" />
          <MetricBig label="Avg Heart Rate" value={data.avgHR} unit="bpm" vs={data.vsAvg.avgHR} inverse />
          <MetricBig label="Training Stress" value={data.tss} unit="TSS" vs={data.vsAvg.tss} />
          <MetricBig label="Intensity Factor" value={data.intensityFactor.toFixed(2)} />
          <MetricBig label="Energy" value={data.kJ} unit="kJ" />
        </div>
      </div>
    </section>
  );
}
