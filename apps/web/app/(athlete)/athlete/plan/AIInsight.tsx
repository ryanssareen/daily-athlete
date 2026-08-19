import type { PlannedWorkoutData } from "./types";

const ATTRIBUTION = {
  ai_review: { label: "✦ AI adjusted", cls: "ai" },
  coach: { label: "Coach adjusted", cls: "coach" },
};

export function AIInsight({ data }: { data: PlannedWorkoutData }) {
  const attr = ATTRIBUTION[data.attribution.kind];

  return (
    <section className="insight-card">
      <div className="insight-head">
        <div className="section-eyebrow">Adaptive plan</div>
        <h2 className="section-title" style={{ fontSize: 19 }}>
          Why this workout
        </h2>
        {attr && <span className={"attr-chip " + attr.cls}>{attr.label}</span>}
      </div>

      <p className="insight-note">{data.attribution.note}</p>

      <div className="insight-desc">
        <p className="section-eyebrow" style={{ marginBottom: 6 }}>
          Coach notes
        </p>
        <p className="insight-desc-text">{data.description}</p>
      </div>

      <a className="insight-link" href="/athlete/week">
        View this week&apos;s plan →
      </a>
    </section>
  );
}
