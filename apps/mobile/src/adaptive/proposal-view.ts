// Pure presentation/decision logic for the mobile AI adaptive proposal modal
// (Unit 11). Mirrors apps/web/src/adaptive/proposal-view.ts — the two app
// packages are isolated, so the logic is duplicated rather than shared, but the
// contract is the @da2/shared types. Keep them in sync.
//
// This module imports NOTHING from react / react-native / expo, so it can be
// unit-tested under the mobile package's Node-only vitest env (the
// useProposal.ts hook is a thin shell over these helpers + the api client).

import type {
  EditOp,
  EditOpResult,
  ProposedEdit,
  StructureChange,
  TriggerKind,
  WeeklyReviewRow,
  WeeklyReviewStatus,
} from "@da2/shared";

// ---------------------------------------------------------------------------
// Trigger-label mapping
// ---------------------------------------------------------------------------

export function triggerLabel(kind: TriggerKind): string {
  switch (kind) {
    case "weekly":
      return "Weekly review";
    case "missed_block":
      return "Based on missed workouts";
    case "schedule_shock":
      return "Based on a change to your schedule";
    case "event_change":
      return "You moved your event date";
    case "fatigue_deload":
      return "Based on signs of fatigue";
    case "progression_bump":
      return "You're ready for more";
    case "workout_swap":
      return "A workout swap you requested";
    case "manual":
      return "A review you requested";
  }
}

// ---------------------------------------------------------------------------
// View-state routing
// ---------------------------------------------------------------------------

export type ProposalViewKind = "proposed" | "no_changes" | "terminal";

export function viewKindForStatus(status: WeeklyReviewStatus): ProposalViewKind {
  if (status === "proposed") return "proposed";
  if (status === "no_changes") return "no_changes";
  return "terminal";
}

export function terminalStatusLabel(status: WeeklyReviewStatus): string {
  switch (status) {
    case "accepted":
      return "Applied";
    case "partially_accepted":
      return "Partially applied";
    case "rejected":
      return "Dismissed";
    case "superseded":
      return "Replaced by a newer review";
    case "expired":
      return "Expired";
    case "no_changes":
      return "No changes needed";
    case "proposed":
      return "Awaiting your review";
  }
}

// ---------------------------------------------------------------------------
// Op-row presentation (before -> after)
// ---------------------------------------------------------------------------

export interface OpRowView {
  opId: string;
  kind: EditOp["kind"];
  verb: string;
  before: string | null;
  after: string;
  reason: string;
  targetDate: string | null;
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}

function fmtIntensity(t: NonNullable<StructureChange["intensity_target"]>): string {
  switch (t.kind) {
    case "ftp_pct":
      return `${t.value}% FTP`;
    case "zone":
      return `Zone ${t.value}`;
    case "pace_s_per_km": {
      const m = Math.floor(t.value / 60);
      const s = Math.round(t.value % 60);
      return `${m}:${s.toString().padStart(2, "0")} /km`;
    }
  }
}

export function describeStructureChange(c: StructureChange): string {
  const parts: string[] = [];
  if (c.duration_s != null) parts.push(fmtDuration(c.duration_s));
  if (c.load != null) parts.push(`${Math.round(c.load)} load`);
  if (c.intensity_target != null) parts.push(fmtIntensity(c.intensity_target));
  return parts.length > 0 ? parts.join(" · ") : "Updated";
}

/** Render-boundary date formatting (date-only). A calendar date must never
 * round-trip through an instant — the 12:00Z anchor showed the day one late
 * for UTC+13/+14 athletes. UTC-pinned formatting of the Y-M-D parts is exact. */
export function formatScheduledDate(dateStr: string, _timezone?: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function toOpRow(edit: ProposedEdit, timezone: string): OpRowView {
  const op = edit.op;
  const base = { opId: op.op_id, kind: op.kind, reason: op.reason };
  switch (op.kind) {
    case "move":
      return {
        ...base,
        verb: "Move",
        before: "Current day",
        after: `Move to ${formatScheduledDate(op.to_date, timezone)}`,
        targetDate: op.to_date,
      };
    case "modify":
      return {
        ...base,
        verb: "Adjust",
        before: "Current session",
        after: describeStructureChange(op.changes),
        targetDate: null,
      };
    case "skip":
      return { ...base, verb: "Skip", before: "Scheduled", after: "Skip this session", targetDate: null };
    case "delete":
      return { ...base, verb: "Remove", before: "Scheduled", after: "Remove from plan", targetDate: null };
    case "insert":
      return {
        ...base,
        verb: "Add",
        before: null,
        after: `Add ${op.sport} · ${describeStructureChange(op.structure)} on ${formatScheduledDate(
          op.on_date,
          timezone
        )}`,
        targetDate: op.on_date,
      };
  }
}

export function toOpRows(reviewRow: WeeklyReviewRow, timezone: string): OpRowView[] {
  return reviewRow.proposed_changes
    .map((e) => toOpRow(e, timezone))
    .sort((a, b) => {
      if (a.targetDate && b.targetDate) {
        if (a.targetDate !== b.targetDate) return a.targetDate < b.targetDate ? -1 : 1;
      } else if (a.targetDate && !b.targetDate) {
        return -1;
      } else if (!a.targetDate && b.targetDate) {
        return 1;
      }
      return a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0;
    });
}

// ---------------------------------------------------------------------------
// Preserved-invariant callouts
// ---------------------------------------------------------------------------

export function preservedInvariants(reviewRow: WeeklyReviewRow): string[] {
  const callouts = ["Load balance maintained"];
  if (reviewRow.event_date_snapshot != null || reviewRow.trigger_kind === "event_change") {
    callouts.push("Taper protected");
  }
  return callouts;
}

// ---------------------------------------------------------------------------
// Cherry-pick selection
// ---------------------------------------------------------------------------

export interface SelectionSummary {
  selectedIds: string[];
  selectedCount: number;
  totalCount: number;
  ctaLabel: string;
  ctaEnabled: boolean;
}

export function selectionSummary(
  allOpIds: string[],
  selected: ReadonlySet<string>
): SelectionSummary {
  const selectedIds = allOpIds.filter((id) => selected.has(id));
  const selectedCount = selectedIds.length;
  const totalCount = allOpIds.length;
  let ctaLabel: string;
  if (selectedCount === 0) {
    ctaLabel = "Select a change to apply";
  } else if (selectedCount === totalCount) {
    ctaLabel = totalCount === 1 ? "Apply this change" : "Accept all changes";
  } else {
    ctaLabel = `Apply ${selectedCount} ${selectedCount === 1 ? "change" : "changes"}`;
  }
  return { selectedIds, selectedCount, totalCount, ctaLabel, ctaEnabled: selectedCount > 0 };
}

// ---------------------------------------------------------------------------
// Apply-result -> per-op outcome
// ---------------------------------------------------------------------------

export interface AppliedOutcome {
  opId: string;
  outcome: string;
  skipped: boolean;
  message: string | null;
}

export function outcomeMessage(outcome: string): string | null {
  switch (outcome) {
    case "applied":
      return null;
    case "skipped_stale":
      return "Workout changed — this change was skipped";
    case "refused_completed":
      return "Already completed — left as-is";
    case "dropped_invalid":
      return "No longer safe with your current load — skipped";
    case "dropped_coach_protected":
      return "Your coach edited this — left as-is";
    default:
      return "This change was skipped";
  }
}

export function appliedOutcomes(results: EditOpResult[]): AppliedOutcome[] {
  return results.map((r) => {
    const skipped = r.outcome !== "applied";
    return { opId: r.op_id, outcome: r.outcome, skipped, message: skipped ? outcomeMessage(r.outcome) : null };
  });
}

export function wasSuperseded(status: string): boolean {
  return status === "superseded";
}

// ---------------------------------------------------------------------------
// Banner / "which proposal to show"
// ---------------------------------------------------------------------------

export interface ReviewBannerContent {
  reviewId: string;
  headline: string;
  triggerLabel: string;
}

/** The single most relevant proposal to render (most recent of any status). */
export function selectActiveProposal(proposals: WeeklyReviewRow[]): WeeklyReviewRow | null {
  const live = proposals.filter((p) => p.deleted_at == null);
  const pending = live
    .filter((p) => p.status === "proposed")
    .sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1));
  if (pending[0]) return pending[0];
  return [...live].sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1))[0] ?? null;
}

export function bannerFor(proposals: WeeklyReviewRow[]): ReviewBannerContent | null {
  const pending = proposals
    .filter((p) => p.status === "proposed" && p.deleted_at == null)
    .sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1));
  const top = pending[0];
  if (!top) return null;
  const n = top.proposed_changes.length;
  const headline =
    n === 0
      ? "Your plan was reviewed"
      : `Your plan was reviewed — ${n} ${n === 1 ? "change" : "changes"} proposed`;
  return { reviewId: top.id, headline, triggerLabel: triggerLabel(top.trigger_kind) };
}
