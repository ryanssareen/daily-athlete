import { POWER_ZONES, fmtClockShort } from "./utils";
import type { PlannedWorkoutData } from "./types";

export function StructureList({ data }: { data: PlannedWorkoutData }) {
  const segments = data.segments;
  const total = segments.reduce((s, seg) => s + seg.durSec, 0);

  return (
    <section className="structure-section">
      <div className="section-head compact">
        <div>
          <div className="section-eyebrow">Workout structure</div>
          <h2 className="section-title">Target</h2>
        </div>
        <div className="zone-legend">
          {POWER_ZONES.slice(0, 5).map((z) => (
            <span className="zone-legend-item" key={z.name}>
              <span className="zone-legend-dot" style={{ background: z.color }} />
              {z.name}
            </span>
          ))}
        </div>
      </div>

      <div className="struct-bar">
        {segments.map((seg, i) => (
          <span
            key={i}
            style={{ width: ((seg.durSec / total) * 100).toFixed(1) + "%", background: POWER_ZONES[seg.zone - 1].color }}
            title={seg.label}
          />
        ))}
      </div>

      <div className="struct-rows">
        {segments.map((seg, i) => (
          <div className="struct-row" key={i}>
            <span className="struct-dot" style={{ background: POWER_ZONES[seg.zone - 1].color }} />
            <span className="struct-label">{seg.label}</span>
            <span className="struct-target">{seg.target}</span>
            <span className="struct-dur mono">{fmtClockShort(seg.durSec)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
