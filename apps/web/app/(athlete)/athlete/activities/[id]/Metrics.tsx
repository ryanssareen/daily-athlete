import type { WorkoutData } from "./types";
import { POWER_ZONES, HR_ZONES } from "./utils";

export function WorkoutMetrics({ data }: { data: WorkoutData }) {
  return (
    <>
      <section className="zones-section">
        <div className="section-head">
          <div>
            <div className="section-eyebrow">Intensity</div>
            <h2 className="section-title">Power Zones</h2>
          </div>
        </div>
        <div className="zones-bars">
          {POWER_ZONES.map((zone, i) => {
            const secs = data.zones.power[i] || 0;
            const pct = (secs / data.duration) * 100;
            return (
              <div key={zone.name} className="zone-bar-item">
                <div className="zone-bar-label">{zone.name}</div>
                <div className="zone-bar-track">
                  <div className="zone-bar-fill" style={{ width: pct + "%", background: zone.color }} />
                </div>
                <div className="zone-bar-time">{Math.round(secs / 60)}m</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="zones-section">
        <div className="section-head">
          <div>
            <div className="section-eyebrow">Intensity</div>
            <h2 className="section-title">Heart Rate Zones</h2>
          </div>
        </div>
        <div className="zones-bars">
          {HR_ZONES.map((zone, i) => {
            const secs = data.zones.hr[i] || 0;
            const pct = (secs / data.duration) * 100;
            return (
              <div key={zone.name} className="zone-bar-item">
                <div className="zone-bar-label">{zone.name}</div>
                <div className="zone-bar-track">
                  <div className="zone-bar-fill" style={{ width: pct + "%", background: zone.color }} />
                </div>
                <div className="zone-bar-time">{Math.round(secs / 60)}m</div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
