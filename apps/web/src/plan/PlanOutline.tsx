import type { PlanView, PlanViewSession, PlanViewWeek } from "@da2/shared";

import { sportColor, sportLabel } from "@/components/training-overview/sport-colors";

import { cardStyle } from "./plan-card-style";
import {
  barTextEquivalent,
  complianceBar,
  EMPTY_COPY,
  formatSessionDay,
  plannedLoadText,
  sessionDurationText,
  type WeekTiming,
  verdictChip,
  verdictsUnavailableNote,
  weekHeader,
  type ChipTone,
} from "./plan-view-format";

const CLAMP_THRESHOLD = 110;

const outlineCss = `
.pv-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pv-expand[open] .pv-clamp{display:none}
.pv-expand summary{list-style:none;cursor:pointer;min-height:44px;display:flex;align-items:center}
.pv-expand summary::-webkit-details-marker{display:none}
.pv-expand[open] .pv-more{display:none}
.pv-week>summary{list-style:none;cursor:pointer;min-height:44px}
.pv-week>summary::-webkit-details-marker{display:none}
`;

const toneStyle: Record<ChipTone, { border: string; glyph: string }> = {
  positive: { border: "var(--color-ink)", glyph: "✓" },
  warning: { border: "var(--color-ink-muted)", glyph: "▲" },
  neutral: { border: "var(--color-border)", glyph: "•" },
};

function VerdictChip({ session }: { session: PlanViewSession }) {
  if (!session.verdict) return null;
  const chip = verdictChip(session.verdict.code);
  const style = toneStyle[chip.tone];
  return (
    <span
      title={session.verdict.headline}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        border: `1px solid ${style.border}`,
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 12,
        fontWeight: 600,
        color: "var(--color-ink)",
      }}
    >
      <span aria-hidden>{style.glyph}</span>
      {chip.label}
    </span>
  );
}

function Rationale({ text }: { text: string }) {
  const style = { fontSize: 12, color: "var(--color-ink-muted)", margin: 0, lineHeight: 1.45 } as const;
  if (text.length <= CLAMP_THRESHOLD) return <p style={style}>{text}</p>;
  return (
    <details className="pv-expand">
      <summary style={{ flexDirection: "column", alignItems: "flex-start", justifyContent: "center" }}>
        <span className="pv-clamp" style={style}>
          {text}
        </span>
        <span className="pv-more" style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink)" }}>
          Show more
        </span>
      </summary>
      <p style={style}>{text}</p>
    </details>
  );
}

function SessionRow({ session }: { session: PlanViewSession }) {
  const meta = [
    formatSessionDay(session.date),
    sessionDurationText(session.plannedSeconds),
    session.intensity,
    plannedLoadText(session.plannedLoad),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li style={{ padding: "10px 0", borderTop: "1px solid var(--color-border)", listStyle: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          aria-hidden
          style={{ width: 10, height: 10, borderRadius: 999, background: sportColor(session.sport) }}
        />
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--color-ink)" }}>
          {sportLabel(session.sport)}
        </span>
        <VerdictChip session={session} />
      </div>
      <p style={{ fontSize: 12, color: "var(--color-ink-muted)", margin: "2px 0 0 20px" }}>{meta}</p>
      {session.rationale && (
        <div style={{ margin: "4px 0 0 20px" }}>
          <Rationale text={session.rationale} />
        </div>
      )}
    </li>
  );
}

function WeekBody({ week, timing }: { week: PlanViewWeek; timing: WeekTiming }) {
  if (week.sessions.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--color-ink-muted)", margin: "8px 0 0" }}>
        {EMPTY_COPY.noWorkouts}
      </p>
    );
  }
  const hasCompleted = week.sessions.some((s) => s.status === "completed");
  return (
    <>
      {week.focus && (
        <p style={{ fontSize: 13, color: "var(--color-ink-muted)", margin: "0 0 6px" }}>{week.focus}</p>
      )}
      {week.dueSeconds === 0 && timing === "past" && (
        <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", margin: "0 0 6px" }}>
          {EMPTY_COPY.nothingDue}
        </p>
      )}
      {!hasCompleted && timing !== "future" && week.dueSeconds > 0 && (
        <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", margin: "0 0 6px" }}>
          {EMPTY_COPY.noResults}
        </p>
      )}
      <ul style={{ margin: 0, padding: 0 }}>
        {week.sessions.map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}
      </ul>
    </>
  );
}

function WeekItem({ week, index, today }: { week: PlanViewWeek; index: number; today: string }) {
  const header = weekHeader(week, index, today);
  const bar = complianceBar(week.compliance);
  const barText = barTextEquivalent(week.executedSeconds, week.dueSeconds, week.compliance);
  return (
    <details
      className="pv-week"
      open={week.current}
      style={{ borderTop: "1px solid var(--color-border)", padding: "6px 0 10px" }}
    >
      <summary>
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 10px" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-ink)" }}>{header.label}</span>
          {header.currentTag && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink)" }}>
              {header.currentTag}
            </span>
          )}
          {header.phaseLabel && (
            <span style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>{header.phaseLabel}</span>
          )}
        </span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", fontSize: 12, color: "var(--color-ink-muted)" }}>
          <span>{header.hoursText}</span>
          <span>{header.complianceText}</span>
          {bar.ahead && <span>ahead of plan</span>}
          {header.skippedText && <span>{header.skippedText}</span>}
        </span>
        <span
          role="img"
          aria-label={barText}
          style={{
            display: "block",
            height: 6,
            borderRadius: 999,
            background: "var(--color-border)",
            overflow: "hidden",
            marginTop: 6,
          }}
        >
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${bar.widthPercent}%`,
              background: "var(--color-ink-muted)",
            }}
          />
        </span>
      </summary>
      <WeekBody week={week} timing={header.timing} />
    </details>
  );
}

export function PlanOutline({
  weeks,
  sectionErrors,
  today,
}: {
  weeks: PlanView["weeks"];
  sectionErrors: PlanView["sectionErrors"];
  today: string;
}) {
  const note = verdictsUnavailableNote(sectionErrors);
  return (
    <section data-testid="plan-outline" aria-label="Week by week" style={cardStyle}>
      <style>{outlineCss}</style>
      <p className="eyebrow" style={{ marginBottom: 8 }}>
        Week by week
      </p>
      {note && (
        <p role="status" style={{ fontSize: 12, color: "var(--color-ink-muted)", margin: "0 0 8px" }}>
          {note}
        </p>
      )}
      {weeks.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-ink-muted)", margin: 0 }}>{EMPTY_COPY.noWorkouts}</p>
      ) : (
        weeks.map((week, index) => <WeekItem key={week.start} week={week} index={index} today={today} />)
      )}
    </section>
  );
}
