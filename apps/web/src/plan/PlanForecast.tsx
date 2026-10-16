import Link from "next/link";

import type { PlanView } from "@da2/shared";

import { cardStyle } from "./plan-card-style";
import { forecastCopy } from "./plan-view-format";

const mutedText = { fontSize: 13, color: "var(--color-ink-muted)", margin: 0 } as const;

function Figure({ label, value, meaning }: { label: string; value: string; meaning: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "6px 0" }}>
      <span style={{ width: 52, fontSize: 20, fontWeight: 600, color: "var(--color-ink)" }}>{value}</span>
      <span style={{ flex: 1 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-ink)" }}>
          {label}
        </span>
        <span style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>{meaning}</span>
      </span>
    </div>
  );
}

export function PlanForecast({
  forecast,
  sectionErrors,
}: {
  forecast: PlanView["forecast"];
  sectionErrors: PlanView["sectionErrors"];
}) {
  const copy = forecastCopy(forecast, sectionErrors);
  return (
    <section data-testid="plan-forecast" aria-label="Forecast" style={cardStyle}>
      <p className="eyebrow" style={{ marginBottom: 8 }}>
        Forecast
      </p>
      {copy.kind === "failed" && (
        <>
          <p style={{ ...mutedText, marginBottom: 8 }}>{copy.title}</p>
          <Link href="/plan" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-ink)" }}>
            Try again
          </Link>
        </>
      )}
      {(copy.kind === "unavailable" || copy.kind === "complete") && (
        <p style={mutedText}>{copy.title}</p>
      )}
      {copy.kind === "ok" && (
        <>
          <p style={{ fontSize: 16, fontWeight: 600, color: "var(--color-ink)", margin: "0 0 2px" }}>
            {copy.headline}
          </p>
          <p style={{ ...mutedText, marginBottom: 8 }}>{copy.endLabel}</p>
          {copy.figures.map((figure) => (
            <Figure key={figure.label} {...figure} />
          ))}
          {copy.eventLabel && (
            <p
              style={{
                ...mutedText,
                marginTop: 10,
                paddingTop: 10,
                borderTop: "1px solid var(--color-border)",
              }}
            >
              {copy.eventLabel}: form {copy.eventForm}
              {copy.eventVerdict ? `, ${copy.eventVerdict.toLowerCase()}` : ""}
            </p>
          )}
        </>
      )}
    </section>
  );
}
