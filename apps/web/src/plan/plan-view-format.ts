import type {
  PlanPhase,
  PlanViewForecast,
  PlanViewSectionError,
  PlanViewWeek,
  VerdictCode,
} from "@da2/shared";

import { formatDurationShort } from "./plan-summary";

export type ChipTone = "positive" | "warning" | "neutral";

export const EMPTY_COPY = {
  noWorkouts: "No workouts scheduled yet",
  noResults: "Results appear as you complete sessions",
  nothingDue: "Nothing was due this week",
} as const;

export const VIEW_ERROR_COPY = "Couldn't load the plan details";

export function verdictChip(code: VerdictCode): { label: string; tone: ChipTone } {
  switch (code) {
    case "executed_as_prescribed":
      return { label: "As prescribed", tone: "positive" };
    case "under_executed":
      return { label: "Under target", tone: "warning" };
    case "over_executed":
      return { label: "Over target", tone: "warning" };
    case "partial_data":
      return { label: "Partial data", tone: "neutral" };
    case "unplanned_effort":
      return { label: "Unplanned", tone: "neutral" };
  }
}

export function verdictsUnavailableNote(errors: PlanViewSectionError[]): string | null {
  return errors.includes("verdicts") ? "Verdicts unavailable right now" : null;
}

export function phaseLabel(phase: PlanPhase | null): string | null {
  if (!phase) return null;
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

export interface ComplianceBar {
  widthPercent: number;
  percentText: string;
  ahead: boolean;
}

export function complianceBar(compliance: number | null): ComplianceBar {
  if (compliance === null) return { widthPercent: 0, percentText: "not yet due", ahead: false };
  const percent = Math.round(compliance * 100);
  return {
    widthPercent: Math.min(100, Math.max(0, percent)),
    percentText: `${percent}%`,
    ahead: compliance > 1,
  };
}

function hoursNumber(seconds: number): string {
  const hours = Math.round((seconds / 3600) * 10) / 10;
  return String(hours);
}

export function barTextEquivalent(
  executedSeconds: number,
  dueSeconds: number,
  compliance: number | null
): string {
  if (compliance === null) return "Not yet due";
  const unit = hoursNumber(dueSeconds) === "1" ? "hour" : "hours";
  return `${hoursNumber(executedSeconds)} of ${hoursNumber(dueSeconds)} ${unit}, ${complianceBar(compliance).percentText}`;
}

export function hoursText(executedSeconds: number, plannedSeconds: number): string {
  return `${formatDurationShort(executedSeconds)} of ${formatDurationShort(plannedSeconds)}`;
}

export function formatShortDate(dateOnly: string): string {
  return new Date(`${dateOnly}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatSessionDay(dateOnly: string): string {
  return new Date(`${dateOnly}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export type WeekTiming = "past" | "current" | "future";

export interface WeekHeader {
  timing: WeekTiming;
  label: string;
  currentTag: string | null;
  phaseLabel: string | null;
  hoursText: string;
  complianceText: string;
  skippedText: string | null;
}

export function weekHeader(week: PlanViewWeek, index: number, today: string): WeekHeader {
  const timing: WeekTiming = week.current ? "current" : week.start < today ? "past" : "future";
  const complianceText =
    week.compliance !== null
      ? complianceBar(week.compliance).percentText
      : timing === "future"
        ? "Upcoming"
        : "not yet due";
  return {
    timing,
    label: `Week ${index + 1} · ${formatShortDate(week.start)}`,
    currentTag: timing === "current" ? "This week" : null,
    phaseLabel: phaseLabel(week.phase),
    hoursText: hoursText(week.executedSeconds, week.plannedSeconds),
    complianceText,
    skippedText: week.skippedCount > 0 ? `${week.skippedCount} skipped` : null,
  };
}

export function sessionDurationText(seconds: number | null): string | null {
  return seconds === null || seconds <= 0 ? null : formatDurationShort(seconds);
}

export function plannedLoadText(load: number | null): string | null {
  return load === null ? null : `Planned load ${Math.round(load)}`;
}

export interface ForecastFigure {
  label: string;
  value: string;
  meaning: string;
}

export type ForecastCopy =
  | { kind: "failed"; title: string }
  | { kind: "unavailable"; title: string }
  | { kind: "complete"; title: string }
  | {
      kind: "ok";
      headline: string;
      figures: ForecastFigure[];
      endLabel: string;
      eventLabel: string | null;
      eventForm: string | null;
      eventVerdict: string | null;
    };

function signed(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

export function forecastCopy(
  forecast: PlanViewForecast,
  sectionErrors: PlanViewSectionError[]
): ForecastCopy {
  if (sectionErrors.includes("forecast")) {
    return { kind: "failed", title: "Couldn't load the forecast" };
  }
  if (forecast.status === "unavailable-no-data") {
    return { kind: "unavailable", title: "Not enough planned load to forecast" };
  }
  if (forecast.status === "unavailable-complete") {
    return { kind: "complete", title: "This block is finished" };
  }
  return {
    kind: "ok",
    headline: forecast.formVerdict,
    figures: [
      {
        label: "Fitness (CTL)",
        value: String(Math.round(forecast.ctl)),
        meaning: "Your long-term training base",
      },
      {
        label: "Fatigue (ATL)",
        value: String(Math.round(forecast.atl)),
        meaning: "How much recent training is still in your legs",
      },
      {
        label: "Form (TSB)",
        value: signed(forecast.tsb),
        meaning: "Fitness minus fatigue; higher means fresher",
      },
    ],
    endLabel: `End of block, ${formatShortDate(forecast.endOfBlockDate)}`,
    eventLabel: forecast.eventDay ? `On ${formatShortDate(forecast.eventDay.date)}` : null,
    eventForm: forecast.eventDay ? signed(forecast.eventDay.tsb) : null,
    eventVerdict: forecast.eventDay ? forecast.eventDay.formVerdict : null,
  };
}
