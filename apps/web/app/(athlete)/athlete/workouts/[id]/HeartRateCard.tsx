import { paletteFor, type ZoneDef } from "@/lib/zone-palette";

interface ZoneBucket {
  min: number;
  max: number;
  time: number;
}

export interface HrZoneEntry {
  type: "heartrate";
  sensor_based?: boolean;
  distribution_buckets: ZoneBucket[];
}

interface Props {
  avgHr: number | null;
  maxHr: number | null;
  hrZone: HrZoneEntry | null;
  /**
   * Strava's `has_heartrate` flag for this activity, when we have it.
   * `false` is a definitive "recorded without an HR sensor"; `null` means
   * we don't know (a manual workout, or a row backfilled before 85e4c80
   * started persisting the flag).
   */
  hasHeartrate?: boolean | null;
  /** Manual workouts never have HR to begin with — don't explain their absence. */
  isStrava?: boolean;
}

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function isHrZoneEntry(value: unknown): value is HrZoneEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.type === "heartrate" && Array.isArray(v.distribution_buckets);
}

export function HeartRateCard({ avgHr, maxHr, hrZone, hasHeartrate, isStrava }: Props) {
  // Returning null here used to make the whole section vanish, leaving the
  // athlete unable to tell "this ride had no HR strap" from "your Strava
  // sync is broken" (#103). Say which it is instead.
  if (avgHr == null && maxHr == null) {
    if (!isStrava) return null;
    return (
      <section className="wd-hr">
        <header className="wd-hr-head">
          <div className="wd-section-eyebrow">Cardiovascular</div>
          <h2 className="wd-section-title">Heart rate</h2>
        </header>
        <p className="wd-hr-empty">
          {hasHeartrate === false
            ? "Strava recorded this activity without a heart-rate sensor, so there is no HR data to show."
            : "Strava has no heart-rate data for this activity."}
        </p>
      </section>
    );
  }

  const buckets = hrZone?.distribution_buckets ?? [];
  const totalSec = buckets.reduce((sum, b) => sum + b.time, 0);
  const palette = hrZone ? paletteFor("heartrate", buckets.length) : [];

  return (
    <section className="wd-hr">
      <header className="wd-hr-head">
        <div className="wd-section-eyebrow">Cardiovascular</div>
        <h2 className="wd-section-title">Heart rate</h2>
      </header>

      <div className="wd-hr-metrics">
        {avgHr != null && (
          <div className="wd-hr-metric">
            <div className="wd-hr-metric-label">Avg HR</div>
            <div className="wd-hr-metric-value">
              <span className="wd-hr-metric-num">{Math.round(avgHr)}</span>
              <span className="wd-hr-metric-unit">bpm</span>
            </div>
          </div>
        )}
        {maxHr != null && (
          <div className="wd-hr-metric">
            <div className="wd-hr-metric-label">Max HR</div>
            <div className="wd-hr-metric-value">
              <span className="wd-hr-metric-num">{Math.round(maxHr)}</span>
              <span className="wd-hr-metric-unit">bpm</span>
            </div>
          </div>
        )}
      </div>

      {hrZone && totalSec > 0 && (
        <>
          <div className="wd-hr-bar">
            {buckets.map((bucket, i) => {
              if (bucket.time <= 0) return null;
              const pct = (bucket.time / totalSec) * 100;
              const def = palette[i] ?? palette[palette.length - 1]!;
              return (
                <div
                  key={i}
                  className="wd-hr-bar-cell"
                  style={{ width: `${pct}%`, background: def.color }}
                  title={`${def.name} ${def.label}: ${fmtTime(bucket.time)}`}
                />
              );
            })}
          </div>
          <ul className="wd-zone-legend">
            {buckets.map((bucket, i) => {
              if (bucket.time <= 0) return null;
              const pct = totalSec > 0 ? (bucket.time / totalSec) * 100 : 0;
              const def: ZoneDef = palette[i] ?? palette[palette.length - 1]!;
              return (
                <li key={i} className="wd-zone-legend-row">
                  <span className="wd-zone-legend-swatch" style={{ background: def.color }} />
                  <span className="wd-zone-legend-name">{def.name}</span>
                  <span className="wd-zone-legend-label">{def.label}</span>
                  <span className="wd-zone-legend-time">{fmtTime(bucket.time)}</span>
                  <span className="wd-zone-legend-pct">{pct.toFixed(0)}%</span>
                </li>
              );
            })}
          </ul>
          {hrZone.sensor_based === false && (
            <p className="wd-hr-estimated">Estimated from activity data — no HR sensor detected</p>
          )}
        </>
      )}
    </section>
  );
}
