import type { TrainingOverview } from "@/training-overview/overview";
import { formVerdict } from "@/training-overview/calc";

const card = {
  background: "var(--color-paper)",
  border: "1px solid var(--color-border)",
  borderRadius: 14,
  padding: "16px 18px",
} as const;

function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(1)}`;
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div style={card}>
      <p style={{ margin: 0, fontSize: 12, color: "var(--color-ink-muted)" }}>{label}</p>
      <p
        style={{
          margin: "6px 0 4px",
          fontSize: 30,
          fontWeight: 600,
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
          color: tone ?? "var(--color-ink)",
        }}
      >
        {value}
      </p>
      <p style={{ margin: 0, fontSize: 12, color: "var(--color-ink-subtle)" }}>{sub}</p>
    </div>
  );
}

export function OverviewKpis({ overview }: { overview: TrainingOverview }) {
  const { ctl, atl, tsb, last28, race } = overview;
  const delta = last28.deltaPct;
  return (
    <section
      aria-label="Current training status"
      style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(136px, 1fr))" }}
    >
      <Kpi label="Fitness (CTL)" value={ctl.toFixed(1)} sub="Long-run training load" />
      <Kpi label="Fatigue (ATL)" value={atl.toFixed(1)} sub="Recent training load" />
      <Kpi
        label="Form (TSB)"
        value={signed(tsb)}
        sub={`Currently ${formVerdict(tsb)}`}
        tone={tsb >= 0 ? "var(--color-success)" : tsb < -30 ? "var(--color-danger)" : undefined}
      />
      <Kpi
        label="Last 28 days"
        value={`${last28.hours.toFixed(1)} h`}
        sub={delta === null ? "No prior 28 days" : `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta * 100))}% vs previous 28`}
      />
      {race && (
        <Kpi label={race.label} value={String(race.days)} sub={`days to go · ${race.date}`} />
      )}
    </section>
  );
}

export function OverviewCard({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={card}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--color-ink)" }}>{title}</h2>
      {note && <p style={{ margin: "4px 0 14px", fontSize: 13, color: "var(--color-ink-muted)" }}>{note}</p>}
      {children}
    </section>
  );
}
