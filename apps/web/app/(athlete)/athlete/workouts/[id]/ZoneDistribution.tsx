import { paletteFor, type ZoneDef } from "@/lib/zone-palette";

// Side-by-side "Power zones" + "Heart-rate zones" cards. Each card
// shows a stacked horizontal bar of zone-time proportions plus a
// legend table with raw time and percentage per zone. Server component
// — data comes from `summary_stats.zones` (an array Strava returns
// from `GET /activities/{id}/zones`).
//
// Renders whichever subset of {power, heart_rate} the athlete has
// data for. When only one type is present, that card takes full
// width (single-column grid).

interface ZoneBucket {
  min: number;
  max: number;
  time: number;
}

interface ZoneEntry {
  type: "heartrate" | "power";
  sensor_based?: boolean;
  custom_zones?: boolean;
  distribution_buckets: ZoneBucket[];
}

interface Props {
  zones: unknown[]; // narrowed below; arrives as the raw JSONB array
}

function isZoneEntry(value: unknown): value is ZoneEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.type === "heartrate" || v.type === "power") &&
    Array.isArray(v.distribution_buckets)
  );
}

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ZoneDistribution({ zones }: Props) {
  const typed = zones.filter(isZoneEntry);
  if (typed.length === 0) return null;

  const power = typed.find((z) => z.type === "power");
  const heart = typed.find((z) => z.type === "heartrate");
  const cards = [power, heart].filter((z): z is ZoneEntry => z != null);

  return (
    <section className="wd-zones">
      <header className="wd-zones-head">
        <div className="wd-section-eyebrow">Zone distribution</div>
        <h2 className="wd-section-title">Where you spent your time</h2>
      </header>
      <div
        className="wd-zones-grid"
        style={{
          gridTemplateColumns: cards.length === 2 ? "1fr 1fr" : "1fr",
        }}
      >
        {cards.map((zone) => (
          <ZoneCard key={zone.type} zone={zone} />
        ))}
      </div>
    </section>
  );
}

function ZoneCard({ zone }: { zone: ZoneEntry }) {
  const totalSec = zone.distribution_buckets.reduce((sum, b) => sum + b.time, 0);
  const palette = paletteFor(zone.type, zone.distribution_buckets.length);
  const title = zone.type === "power" ? "Power zones" : "Heart-rate zones";
  const subtitle = zone.type === "power"
    ? `${zone.distribution_buckets.length} zones`
    : (zone.sensor_based ? "Sensor-based" : "Estimated");

  return (
    <div className="wd-zone-card">
      <div className="wd-zone-card-head">
        <div className="wd-zone-card-title">{title}</div>
        <div className="wd-zone-card-sub">{subtitle}</div>
      </div>
      <div className="wd-zone-stacked">
        {zone.distribution_buckets.map((bucket, i) => {
          const pct = totalSec > 0 ? (bucket.time / totalSec) * 100 : 0;
          // Render every non-zero bucket so the bar widths sum to 100%
          // and visually match the legend percentages below (CORR-9 fix).
          if (bucket.time <= 0) return null;
          const def = palette[i] ?? palette[palette.length - 1]!;
          return (
            <div
              key={i}
              className="wd-zone-stacked-cell"
              style={{ width: `${pct}%`, background: def.color }}
              title={`${def.name} ${def.label}: ${fmtTime(bucket.time)}`}
            />
          );
        })}
      </div>
      <ul className="wd-zone-legend">
        {zone.distribution_buckets.map((bucket, i) => {
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
    </div>
  );
}
