import type { SportRow } from "@/training-overview/calc";

import { sportColor, sportLabel } from "./sport-colors";

const th = {
  textAlign: "right",
  fontWeight: 500,
  fontSize: 12,
  color: "var(--color-ink-muted)",
  padding: "6px 8px",
  borderBottom: "1px solid var(--color-border)",
} as const;
const td = {
  textAlign: "right",
  padding: "8px",
  borderBottom: "1px solid var(--color-border)",
  fontVariantNumeric: "tabular-nums",
  fontSize: 14,
} as const;

export function BySportTable({ sports }: { sports: SportRow[] }) {
  if (sports.length === 0) return null;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Sport</th>
            <th style={th}>Sessions · 28d</th>
            <th style={th}>Hours · 28d</th>
            <th style={th}>Sessions · all</th>
            <th style={th}>Hours · all</th>
          </tr>
        </thead>
        <tbody>
          {sports.map((s) => (
            <tr key={s.sport}>
              <td style={{ ...td, textAlign: "left" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: sportColor(s.sport),
                    marginRight: 8,
                  }}
                />
                {sportLabel(s.sport)}
              </td>
              <td style={td}>{s.sessions28}</td>
              <td style={td}>{s.hours28.toFixed(1)}</td>
              <td style={td}>{s.sessionsAll}</td>
              <td style={td}>{s.hoursAll.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
