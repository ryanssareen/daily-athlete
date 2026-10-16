import type { PlanPhase, PlanView } from "@da2/shared";
import {
  PLAN_VIEW_FOCUS_MAX_LENGTH,
  PLAN_VIEW_QUOTE_MAX_LENGTH,
  PlanPhaseSchema,
} from "@da2/shared";

import { readStructureDurationSeconds } from "@/ai/planned-structure";
import { sportLabel } from "@/components/training-overview/sport-colors";
import { dayDiff } from "@/training-load/load-series";

import { formatDurationShort, mondayOf } from "./plan-summary";
import type { CountedSession } from "./plan-view-types";

export const RECOVERY_FRACTION = 0.75;
export const TAPER_FRACTION = 0.9;
export const TAPER_MAX_WEEKS = 2;

const PHASE_ORDER: readonly PlanPhase[] = ["build", "recovery", "peak", "taper"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function utcDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00Z`);
}

function formatDay(dateOnly: string): string {
  const d = utcDate(dateOnly);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function seconds(session: CountedSession): number | null {
  return readStructureDurationSeconds(session.structure);
}

function readStoredPhase(session: CountedSession): PlanPhase | null {
  const parsed = PlanPhaseSchema.safeParse(session.structure?.phase);
  return parsed.success ? parsed.data : null;
}

export function groupByWeek(sessions: CountedSession[]): Map<string, CountedSession[]> {
  const weeks = new Map<string, CountedSession[]>();
  for (const session of sessions) {
    const key = mondayOf(session.date);
    weeks.set(key, [...(weeks.get(key) ?? []), session]);
  }
  return new Map([...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function sumSeconds(sessions: CountedSession[]): number | null {
  const values = sessions.map(seconds).filter((v): v is number => v != null);
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
}

function mostCommonPhase(phases: PlanPhase[]): PlanPhase | null {
  let best: PlanPhase | null = null;
  let bestCount = 0;
  for (const phase of PHASE_ORDER) {
    const count = phases.filter((p) => p === phase).length;
    if (count > bestCount) {
      best = phase;
      bestCount = count;
    }
  }
  return best;
}

export function detectPhases(input: {
  sessions: CountedSession[];
  eventDate: string | null;
}): Map<string, PlanPhase | null> {
  const { sessions, eventDate } = input;
  const weeks = groupByWeek(sessions);
  const result = new Map<string, PlanPhase | null>();
  if (weeks.size === 0) return result;

  const stored = sessions.map(readStoredPhase);
  if (stored.every((phase): phase is PlanPhase => phase != null)) {
    for (const [monday, weekSessions] of weeks) {
      result.set(monday, mostCommonPhase(weekSessions.flatMap((s) => {
          const phase = readStoredPhase(s);
          return phase ? [phase] : [];
        })));
    }
    return result;
  }

  const volumes = [...weeks.entries()].map(([monday, weekSessions]) => ({
    monday,
    volume: sumSeconds(weekSessions),
  }));
  for (const { monday, volume } of volumes) {
    if (volume == null || volume <= 0) result.set(monday, null);
  }
  const measured = volumes.filter(
    (w): w is { monday: string; volume: number } => w.volume != null && w.volume > 0,
  );

  const taper = new Set<string>();
  if (eventDate != null) {
    const beforeEvent = measured
      .filter((w) => w.monday <= eventDate && dayDiff(w.monday, eventDate) <= TAPER_MAX_WEEKS * 7)
      .slice(-TAPER_MAX_WEEKS);
    for (const w of beforeEvent) {
      const index = measured.findIndex((m) => m.monday === w.monday);
      const priorPeak = Math.max(0, ...measured.slice(0, index).map((m) => m.volume));
      if (index > 0 && w.volume < priorPeak * TAPER_FRACTION) taper.add(w.monday);
    }
  }

  const recovery = new Set<string>();
  measured.forEach((w, index) => {
    if (index === 0 || index === measured.length - 1 || taper.has(w.monday)) return;
    if (w.volume <= measured[index - 1].volume * RECOVERY_FRACTION) recovery.add(w.monday);
  });

  const remaining = measured.filter((w) => !taper.has(w.monday) && !recovery.has(w.monday));
  const maxVolume = Math.max(0, ...remaining.map((w) => w.volume));
  const atMax = remaining.filter((w) => w.volume === maxVolume);
  const peakMonday = remaining.length > 1 && atMax.length === 1 ? atMax[0].monday : null;

  for (const w of measured) {
    if (taper.has(w.monday)) result.set(w.monday, "taper");
    else if (recovery.has(w.monday)) result.set(w.monday, "recovery");
    else if (w.monday === peakMonday) result.set(w.monday, "peak");
    else result.set(w.monday, "build");
  }
  return new Map([...result.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function dominantSport(sessions: CountedSession[]): string | null {
  const totals = new Map<string, { seconds: number; count: number }>();
  for (const session of sessions) {
    const entry = totals.get(session.sport) ?? { seconds: 0, count: 0 };
    totals.set(session.sport, {
      seconds: entry.seconds + (seconds(session) ?? 0),
      count: entry.count + 1,
    });
  }
  const ranked = [...totals.entries()].sort(
    ([nameA, a], [nameB, b]) => b.seconds - a.seconds || b.count - a.count || nameA.localeCompare(nameB),
  );
  return ranked[0]?.[0] ?? null;
}

function longestSession(sessions: CountedSession[]): CountedSession | null {
  let best: CountedSession | null = null;
  let bestSeconds = 0;
  for (const session of sessions) {
    const value = seconds(session);
    if (value != null && value > bestSeconds) {
      best = session;
      bestSeconds = value;
    }
  }
  return best;
}

function capAtWordBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, "");
  return `${trimmed}…`;
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function listDays(mondays: string[]): string {
  return mondays.map(formatDay).join(", ");
}

function composeSummaryParagraph(sessions: CountedSession[], weekCount: number): string {
  const total = sumSeconds(sessions);
  const sports = new Set(sessions.map((s) => s.sport));
  const lead = `A ${weekCount}-week plan with ${pluralize(sessions.length, "session")}`;
  const volume = total != null && total > 0 ? `, about ${formatDurationShort(total)} in total` : "";
  const top = dominantSport(sessions);
  const emphasis =
    top == null ? "" : sports.size === 1 ? `, all ${top}` : `, mostly ${top}`;
  return `${lead}${volume}${emphasis}.`;
}

function composeArcSentence(phases: Map<string, PlanPhase | null>): string | null {
  const byPhase = (phase: PlanPhase) =>
    [...phases.entries()].filter(([, p]) => p === phase).map(([monday]) => monday);
  const build = byPhase("build");
  const recovery = byPhase("recovery");
  const peak = byPhase("peak");
  const taper = byPhase("taper");
  if (recovery.length + peak.length + taper.length === 0) return null;

  const clauses: string[] = [];
  if (build.length > 0) clauses.push(`builds over ${pluralize(build.length, "week")}`);
  if (recovery.length > 0) {
    clauses.push(
      recovery.length === 1
        ? `eases off with a recovery week (week of ${listDays(recovery)})`
        : `eases off with recovery weeks (weeks of ${listDays(recovery)})`,
    );
  }
  if (peak.length > 0) clauses.push(`peaks in the week of ${listDays(peak)}`);
  if (taper.length > 0) {
    clauses.push(
      taper.length === 1
        ? `tapers in the week of ${listDays(taper)}`
        : `tapers in the weeks of ${listDays(taper)}`,
    );
  }
  const joined =
    clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join(", ")}, then ${clauses[clauses.length - 1]}`;
  return `The block ${joined}.`;
}

function composeEventSentence(
  eventType: string | null,
  eventDate: string | null,
  today: string,
): string | null {
  if (eventDate == null || eventDate < today) return null;
  const days = dayDiff(today, eventDate);
  const distance = days === 0 ? "today" : `in ${pluralize(days, "day")}`;
  const label = eventType != null && eventType.trim() !== "" ? `Your ${eventType.trim()}` : "Your goal event";
  return `${label} is on ${formatDay(eventDate)}, ${distance}.`;
}

function composeWhyQuote(
  sessions: CountedSession[],
  phases: Map<string, PlanPhase | null>,
): string | null {
  const peakMonday = [...phases.entries()].find(([, p]) => p === "peak")?.[0];
  if (peakMonday == null) return null;
  const key = longestSession(sessions.filter((s) => mondayOf(s.date) === peakMonday));
  const rationale = key?.rationale?.trim();
  if (!rationale) return null;
  return capAtWordBoundary(rationale, PLAN_VIEW_QUOTE_MAX_LENGTH);
}

export function composePlanStory(input: {
  sessions: CountedSession[];
  eventType: string | null;
  eventDate: string | null;
  today: string;
  phases: Map<string, PlanPhase | null>;
}): PlanView["story"] {
  const { sessions, eventType, eventDate, today, phases } = input;
  const mondays = [...groupByWeek(sessions).keys()];
  const weekCount =
    mondays.length === 0
      ? 0
      : Math.round(dayDiff(mondays[0], mondays[mondays.length - 1]) / 7) + 1;

  const first =
    sessions.length === 0
      ? "This plan has no scheduled sessions yet."
      : composeSummaryParagraph(sessions, weekCount);
  const second = [
    composeArcSentence(phases),
    composeEventSentence(eventType, eventDate, today),
  ].filter((part): part is string => part != null);

  return {
    paragraphs: second.length > 0 ? [first, second.join(" ")] : [first],
    whyQuote: composeWhyQuote(sessions, phases),
  };
}

export function composeWeekFocus(sessions: CountedSession[]): string {
  const top = dominantSport(sessions);
  if (top == null) return "No sessions";
  const long = longestSession(sessions);
  const focus = `${sportLabel(top)} focus`;
  const text =
    long == null
      ? focus
      : `${focus}, long ${long.sport} ${WEEKDAYS[utcDate(long.date).getUTCDay()]}`;
  return text.slice(0, PLAN_VIEW_FOCUS_MAX_LENGTH);
}
