import type { WorkoutData } from "./types";
import { SPORT_ACCENT } from "./utils";

export function WorkoutIntervals({ data }: { data: WorkoutData }) {
  const accent = SPORT_ACCENT[data.sport];
  const reps = data.workReps;
  const maxW = Math.max(...reps.map((r) => Math.max(r.targetW, r.actualW))) + 40;
  const targetW = reps[0]?.targetW ?? 300;
  const totalActualAvg = Math.round(reps.reduce((s, r) => s + r.actualW, 0) / reps.length);
  const delta = totalActualAvg - targetW;
  const hit = Math.abs(delta) <= 15;

  return (
    <section className="intervals-section" style={{ "--accent": accent.color, "--accent-deep": accent.deep, "--accent-soft": accent.soft } as React.CSSProperties}>
      <div className="section-head">
        <div>
          <div className="section-eyebrow">Workout structure</div>
          <h2 className="section-title">
            Planned <span className="muted">vs</span> Executed
          </h2>
        </div>
        <div className="intervals-summary">
          <div className={"match-status " + (hit ? "match-ok" : "match-off")}>
            <span className="match-dot" />
            {hit ? "On target" : delta > 0 ? "Overshot target" : "Undershot target"}
          </div>
          <div className="match-detail">
            Avg <strong>{totalActualAvg} W</strong> vs target <strong>{targetW} W</strong>
            <span className="delta-num">
              {delta > 0 ? "+" : ""}
              {delta} W
            </span>
          </div>
        </div>
      </div>

      <div className="planned-line">
        <span className="planned-label">Target</span>
        <span className="planned-spec">5 × 4 min @ {targetW} W (Z5) · 3 min recovery @ 150 W</span>
      </div>

      <div className="rep-grid">
        {reps.map((rep) => {
          const targetPct = (rep.targetW / maxW) * 100;
          const actualPct = (rep.actualW / maxW) * 100;
          const rdelta = rep.actualW - rep.targetW;
          const rhit = Math.abs(rdelta) <= 15;
          return (
            <div key={rep.i} className="rep-row">
              <div className="rep-num">{rep.repNum}</div>
              <div className="rep-bars">
                <div className="rep-bar-row">
                  <span className="rep-bar-label">target</span>
                  <div className="rep-bar-track">
                    <div className="rep-bar-target" style={{ width: targetPct + "%" }} />
                  </div>
                  <span className="rep-bar-value">{rep.targetW} W</span>
                </div>
                <div className="rep-bar-row">
                  <span className="rep-bar-label">actual</span>
                  <div className="rep-bar-track">
                    <div className="rep-bar-actual" style={{ width: actualPct + "%" }} />
                    <div className="rep-bar-target-line" style={{ left: targetPct + "%" }} title={`Target: ${rep.targetW} W`} />
                  </div>
                  <span className={"rep-bar-value " + (rhit ? "v-ok" : rdelta > 0 ? "v-over" : "v-under")}>
                    {rep.actualW} W<span className="rep-delta">{rdelta > 0 ? "+" : ""}{rdelta}</span>
                  </span>
                </div>
              </div>
              <div className="rep-meta">
                <div>
                  <span className="rep-meta-k">Duration</span> {(rep.durSec / 60).toFixed(0)}min
                </div>
                <div>
                  <span className="rep-meta-k">Avg HR</span> {rep.avgHR} bpm
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
