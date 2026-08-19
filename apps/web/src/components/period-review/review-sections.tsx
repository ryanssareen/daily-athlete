// Presentational section renderers for a period review (U7).
//
// The section taxonomy -- a stat row, a prescribed-vs-actual comparison row, a
// sport-split table, a highlight callout, prose -- is borrowed from the
// WORKOUT-SITE reference codebase's report renderer. The CODE is not: that
// codebase is Tailwind + shadcn over Firestore, and its renderer is driven by
// model-authored section JSON, which is exactly the posture KTD2 rejects here.
// These render numbers our own arithmetic produced.
//
// Styling follows this repo's own idiom (inline `var(--color-*)` tokens), the
// same as app-nav.tsx and the athlete pages.
//
// THE RULE RUNNING THROUGH EVERY RENDERER: unknown is never drawn as zero. A
// null distance renders as an em dash, an unavailable comparison renders as
// "not comparable", and neither is allowed to look like a measured zero the
// athlete could act on.

import type { PeriodFacts, PeriodMetric, PeriodSportRollup } from "@da2/shared";

// Formatting and every other pure decision live in ./review-view so they are
// testable under this repo's Node-only vitest environment (no jsdom). Re-export
// them here so the pages have one import site for the review UI.
export { formatDelta, formatDistance, formatDuration, loadHint, periodLabel } from "./review-view";

import { formatDelta, formatDistance, formatDuration } from "./review-view";

const STATUS_COLOR: Record<string, string> = {
  on_target: "var(--color-ink)",
  under: "var(--color-ink-muted)",
  over: "var(--color-ink-muted)",
};

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export function StatRow({
  items,
}: {
  items: Array<{ label: string; value: string; hint?: string }>;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 12,
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            background: "var(--color-paper)",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "var(--color-ink-muted)",
            }}
          >
            {item.label}
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 24, fontWeight: 600, color: "var(--color-ink)" }}>
            {item.value}
          </p>
          {item.hint && (
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-ink-muted)" }}>
              {item.hint}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function ComparisonRow({
  label,
  metric,
  format,
}: {
  label: string;
  metric: PeriodMetric;
  format: (n: number) => string;
}) {
  if (metric.status === "unavailable") {
    return (
      <div style={rowStyle}>
        <span style={{ color: "var(--color-ink)" }}>{label}</span>
        <span style={{ color: "var(--color-ink-muted)", fontSize: 13 }}>
          not comparable — nothing was prescribed
        </span>
      </div>
    );
  }
  return (
    <div style={rowStyle}>
      <span style={{ color: "var(--color-ink)" }}>{label}</span>
      <span style={{ color: STATUS_COLOR[metric.status] ?? "var(--color-ink)", fontSize: 14 }}>
        {format(metric.actual)} of {format(metric.prescribed)}{" "}
        <span style={{ color: "var(--color-ink-muted)" }}>({formatDelta(metric.deltaPct)})</span>
      </span>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: 16,
  padding: "10px 0",
  borderBottom: "1px solid var(--color-border)",
};

export function SportTable({ sports }: { sports: PeriodSportRollup[] }) {
  if (sports.length === 0) {
    return (
      <p style={{ color: "var(--color-ink-muted)", fontSize: 14, margin: 0 }}>
        No sessions logged in this period.
      </p>
    );
  }

  return (
    // Wide content scrolls inside its own container rather than pushing the
    // page sideways on a narrow screen.
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr>
            {["Sport", "Sessions", "Time", "Distance", "Load"].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: h === "Sport" ? "left" : "right",
                  padding: "8px 12px 8px 0",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: "var(--color-ink-muted)",
                  fontWeight: 500,
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sports.map((s) => (
            <tr key={s.sport}>
              <td style={cellStyle("left")}>{s.sport}</td>
              <td style={cellStyle("right")}>{s.sessions}</td>
              <td style={cellStyle("right")}>{formatDuration(s.durationS)}</td>
              <td style={cellStyle("right")}>{formatDistance(s.distanceM)}</td>
              <td style={cellStyle("right")}>{Math.round(s.load)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cellStyle(align: "left" | "right"): React.CSSProperties {
  return {
    textAlign: align,
    padding: "10px 12px 10px 0",
    borderBottom: "1px solid var(--color-border)",
    color: "var(--color-ink)",
  };
}

export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--color-clay-soft)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "14px 16px",
        color: "var(--color-clay-deep)",
        fontSize: 14,
      }}
    >
      {children}
    </div>
  );
}

/**
 * LLM-authored prose. Rendered as PLAIN TEXT via JSX interpolation -- never
 * `dangerouslySetInnerHTML`. The narration is untrusted model output, and the
 * length cap in `PeriodNarrationSchema` bounds it but says nothing about its
 * content.
 */
export function Prose({ text }: { text: string }) {
  return (
    <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "var(--color-ink)" }}>{text}</p>
  );
}

export function ComparisonToPrevious({ facts }: { facts: PeriodFacts }) {
  if (!facts.comparison.available) {
    return (
      <p style={{ color: "var(--color-ink-muted)", fontSize: 14, margin: 0 }}>
        No earlier period to compare against yet.
      </p>
    );
  }
  const c = facts.comparison;
  return (
    <div>
      <ComparisonDelta label="Sessions" pct={c.sessionsDeltaPct} />
      <ComparisonDelta label="Time" pct={c.durationDeltaPct} />
      <ComparisonDelta label="Load" pct={c.loadDeltaPct} />
      <div style={rowStyle}>
        <span style={{ color: "var(--color-ink)" }}>Active days</span>
        <span style={{ color: "var(--color-ink-muted)", fontSize: 14 }}>
          {c.activeDaysDelta > 0 ? "+" : ""}
          {c.activeDaysDelta}
        </span>
      </div>
    </div>
  );
}

function ComparisonDelta({ label, pct }: { label: string; pct: number }) {
  return (
    <div style={rowStyle}>
      <span style={{ color: "var(--color-ink)" }}>{label}</span>
      <span style={{ color: "var(--color-ink-muted)", fontSize: 14 }}>{formatDelta(pct)}</span>
    </div>
  );
}
