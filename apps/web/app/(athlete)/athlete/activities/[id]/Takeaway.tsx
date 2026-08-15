import type { WorkoutData } from "./types";

export function WorkoutTakeaway({ data }: { data: WorkoutData }) {
  const avgPower = Math.round(data.workReps.reduce((s, r) => s + r.actualW, 0) / data.workReps.length);
  const powerDelta = avgPower - (data.workReps[0]?.targetW ?? 300);

  return (
    <section className="ai-section">
      <div className="ai-head">
        <div className="ai-mark">
          <span className="ai-mark-dot" />
          <span className="ai-mark-text">Coach takeaway</span>
        </div>
        <span className="ai-meta">Generated 4 min after upload</span>
      </div>
      <p className="ai-body">
        Strong VO2 session — you held an average of <strong>{avgPower} W</strong> across the 5 work-reps, sitting <strong>{powerDelta > 0 ? "+" : ""}{powerDelta} W above target</strong>. Recovery valleys came back down to <strong>~92 bpm</strong> within 90 seconds, which is sharper than your 4-week trend.
      </p>
      <p className="ai-body">
        Watch the slight drift on rep 4 ({data.workReps[3]?.actualW} W) — likely a pacing dip after the Skyline climb. Otherwise this is a benchmark-quality interval day; consider bumping target to <strong>{Math.round(avgPower * 1.02)} W</strong> next time.
      </p>
      <div className="ai-actions">
        <button className="ai-btn primary">Save to training log</button>
        <button className="ai-btn">Ask follow-up</button>
        <button className="ai-btn ghost">Dismiss</button>
      </div>
    </section>
  );
}
