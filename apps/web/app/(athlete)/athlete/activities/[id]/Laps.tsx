import { useState } from "react";
import type { WorkoutData } from "./types";
import { fmtClockShort } from "./utils";

export function WorkoutLaps({ data }: { data: WorkoutData }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <section className="laps-section">
      <div className="section-head compact">
        <div>
          <div className="section-eyebrow">Splits</div>
          <h2 className="section-title">Every segment of the ride</h2>
        </div>
        <span className="laps-count">{data.laps.length} segments</span>
      </div>
      <div className="laps-table">
        <div className="laps-row laps-row-head">
          <span>#</span>
          <span>Segment</span>
          <span>Duration</span>
          <span>Avg Power</span>
          <span>Avg HR</span>
          <span>Target</span>
        </div>
        {data.laps.map((lap) => {
          const open = expanded === lap.i;
          const delta = lap.kind === "work" ? lap.avgW - lap.targetW : null;
          return (
            <div key={lap.i}>
              <div
                className={"laps-row " + (lap.kind === "work" ? "is-work" : "") + (open ? " is-open" : "")}
                onClick={() => setExpanded(open ? null : lap.i)}
                role="button"
                tabIndex={0}
              >
                <span className="lap-num">{lap.i + 1}</span>
                <span className="lap-label">
                  <span className={"lap-kind kind-" + lap.kind} />
                  {lap.label}
                </span>
                <span className="lap-val mono">{fmtClockShort(lap.durSec)}</span>
                <span className="lap-val mono">{lap.avgW} W</span>
                <span className="lap-val mono">{lap.avgHR} bpm</span>
                <span className={"lap-target mono " + (delta == null ? "muted" : Math.abs(delta) <= 15 ? "ok" : delta > 0 ? "over" : "under")}>
                  {lap.targetW} W
                  {delta != null && <span className="lap-delta">{delta > 0 ? "+" : ""}{delta}</span>}
                </span>
              </div>
              {open && (
                <div className="lap-expand">
                  <div className="lap-expand-grid">
                    <div>
                      <span className="k">Distance</span>
                      <span className="v">{(lap.distM / 1000).toFixed(2)} km</span>
                    </div>
                    <div>
                      <span className="k">Pace</span>
                      <span className="v">{((lap.durSec / 60) / (lap.distM / 1000)).toFixed(2)} min/km</span>
                    </div>
                    <div>
                      <span className="k">Cadence</span>
                      <span className="v">{lap.kind === "work" ? 92 : 84} rpm</span>
                    </div>
                    <div>
                      <span className="k">Avg Speed</span>
                      <span className="v">{((lap.distM / lap.durSec) * 3.6).toFixed(1)} km/h</span>
                    </div>
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
