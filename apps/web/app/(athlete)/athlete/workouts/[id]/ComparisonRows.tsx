// Prescribed-vs-actual comparison rows (Unit U7,
// docs/plans/2026-08-18-001-feat-workout-reports-plan.md).
//
// Pure presentational, no directive — same reasoning as VerdictHeader.tsx.
//
// Two structural guarantees, both enforced here rather than left to caller
// discipline:
//   - R4/AE3: an UNMATCHED delta (`matched: false`) renders no comparison
//     block at all — `visibleDimensionRows` returns `[]` and the component
//     returns `null`.
//   - KTD8: a dimension with `status: "unavailable"` is OMITTED, never
//     rendered as a dash/blank/"n/a" — a missing prescription is not a data
//     error worth showing the athlete.

import type { DimensionDelta, ExecutionDelta, IntensityDimensionDelta, IntensityTarget } from "@da2/shared";

import { formatDuration } from "@/lib/format";

export type DimensionRowStatus = "on_target" | "under" | "over";

export interface DimensionRowView {
  key: "duration" | "load" | "intensity";
  label: string;
  status: DimensionRowStatus;
  actualLabel: string;
  prescribedLabel: string;
  /** Signed percent, e.g. "+6%" / "-12%". */
  deltaLabel: string;
  /** Raw signed percent, used to position the meter dot. */
  deltaPct: number;
}

/**
 * Meter geometry. The track spans +/- METER_RANGE_PCT around a centre tick that
 * represents the prescribed value; the dot sits at the actual. Deltas beyond the
 * range clamp to the ends rather than overflowing -- past a certain point "way
 * over" and "further over" are the same message to an athlete.
 */
export const METER_RANGE_PCT = 50;

/** Dot offset as a 0-100 percentage of the track width. */
export function meterOffsetPct(deltaPct: number): number {
  const clamped = Math.max(-METER_RANGE_PCT, Math.min(METER_RANGE_PCT, deltaPct));
  return 50 + (clamped / METER_RANGE_PCT) * 50;
}

// --- Formatting --------------------------------------------------------------

function formatDeltaPct(pct: number): string {
  const rounded = Math.round(pct);
  return rounded > 0 ? `+${rounded}%` : `${rounded}%`;
}

function formatLoad(value: number): string {
  return `${Math.round(value)} TSS`;
}

/**
 * `resolveIntensity` in delta.ts (Unit U3) resolves every IntensityTarget
 * kind into a comparable number in the SAME unit space as its `target.kind`
 * (ftp_pct -> %FTP, zone -> %HRmax [the zone's midpoint, not the raw hr],
 * pace_s_per_km -> seconds/km) — see delta.ts's resolveIntensity. Formatting
 * must follow that unit space, not re-derive the zone number.
 */
function formatIntensityValue(value: number, kind: IntensityTarget["kind"]): string {
  switch (kind) {
    case "ftp_pct":
      return `${Math.round(value)}% FTP`;
    case "zone":
      return `${Math.round(value)}% HR max`;
    case "pace_s_per_km": {
      const m = Math.floor(value / 60);
      const s = Math.round(value % 60);
      return `${m}:${s.toString().padStart(2, "0")} /km`;
    }
  }
}

/** The prescribed target itself, for the row label (e.g. "Intensity (75% FTP target)"). */
function formatIntensityTargetLabel(target: IntensityTarget): string {
  switch (target.kind) {
    case "ftp_pct":
      return `${target.value}% FTP target`;
    case "zone":
      return `Zone ${target.value} target`;
    case "pace_s_per_km": {
      const m = Math.floor(target.value / 60);
      const s = Math.round(target.value % 60);
      return `${m}:${s.toString().padStart(2, "0")} /km target`;
    }
  }
}

// --- Dimension -> row projection ---------------------------------------------

function durationRow(d: DimensionDelta): DimensionRowView | null {
  if (d.status === "unavailable") return null;
  return {
    key: "duration",
    label: "Duration",
    status: d.status,
    actualLabel: formatDuration(d.actual),
    prescribedLabel: formatDuration(d.prescribed),
    deltaLabel: formatDeltaPct(d.deltaPct),
    deltaPct: d.deltaPct,
  };
}

function loadRow(d: DimensionDelta): DimensionRowView | null {
  if (d.status === "unavailable") return null;
  return {
    key: "load",
    label: "Load",
    status: d.status,
    actualLabel: formatLoad(d.actual),
    prescribedLabel: formatLoad(d.prescribed),
    deltaLabel: formatDeltaPct(d.deltaPct),
    deltaPct: d.deltaPct,
  };
}

function intensityRow(d: IntensityDimensionDelta): DimensionRowView | null {
  if (d.status === "unavailable") return null;
  return {
    key: "intensity",
    label: `Intensity (${formatIntensityTargetLabel(d.target)})`,
    status: d.status,
    actualLabel: formatIntensityValue(d.actual, d.target.kind),
    prescribedLabel: formatIntensityValue(d.prescribed, d.target.kind),
    deltaLabel: formatDeltaPct(d.deltaPct),
    deltaPct: d.deltaPct,
  };
}

/**
 * Every visible comparison row for a delta, in a fixed order
 * (duration, load, intensity). Unmatched deltas and fully-unavailable
 * matched deltas both yield `[]` — the component treats an empty array as
 * "render nothing".
 */
export function visibleDimensionRows(delta: ExecutionDelta): DimensionRowView[] {
  if (!delta.matched) return [];
  const rows: DimensionRowView[] = [];
  const duration = durationRow(delta.dimensions.duration);
  if (duration) rows.push(duration);
  const load = loadRow(delta.dimensions.load);
  if (load) rows.push(load);
  const intensity = intensityRow(delta.dimensions.intensity);
  if (intensity) rows.push(intensity);
  return rows;
}

// --- Component -----------------------------------------------------------------

interface Props {
  delta: ExecutionDelta;
}

export function ComparisonRows({ delta }: Props) {
  const rows = visibleDimensionRows(delta);
  if (rows.length === 0) return null;

  return (
    <ul className="wd-report-comparison">
      {rows.map((row) => (
        <li key={row.key} className={`wd-report-row wd-report-row-${row.status}`}>
          <div className="wd-report-row-head">
            <span className="wd-report-row-label">{row.label}</span>
            <span className="wd-report-row-values">
              <span className="wd-report-row-actual">{row.actualLabel}</span>
              <span className="wd-report-row-vs">vs</span>
              <span className="wd-report-row-prescribed">{row.prescribedLabel}</span>
            </span>
          </div>
          <div className="wd-report-meter" aria-hidden="true">
            <span className="wd-report-meter-track" />
            <span className="wd-report-meter-tick" />
            <span
              className={`wd-report-meter-dot wd-report-meter-dot-${row.status}`}
              style={{ left: `${meterOffsetPct(row.deltaPct)}%` }}
            />
          </div>
          <span className={`wd-report-row-delta wd-report-row-delta-${row.status}`}>
            {row.deltaLabel}
          </span>
        </li>
      ))}
    </ul>
  );
}
