// Pure presentation/decision logic for the AI adaptive proposal surface
// (Unit 11). Lives separate from the React tree so it can be unit-tested under
// the Node-only vitest environment (no jsdom / RN), mirroring the
// strava-machine.ts pattern: the component is a thin shell over these helpers.
//
// Shared by:
//   - apps/web/app/(athlete)/athlete/review/page.tsx   (athlete web)
//   - apps/web/app/(coach)/athletes/[id]/review        (coach web)
//   - the page.test.tsx unit tests
//
// The mobile surface re-implements the equivalent helpers in
// apps/mobile/src/adaptive/useProposal.ts (the two app packages are isolated;
// the logic is small and the contract is the @da2/shared types). Keep the two
// in sync when the contract changes.

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
// Trigger-label mapping (page hierarchy: human-readable "why this happened")
// ---------------------------------------------------------------------------

/**
 * Maps the machine `trigger_kind` to the athlete-facing label that heads the
 * proposal (plan: "Based on missed workouts" / "Weekly review" / "You moved
 * your event date"). Every TriggerKind in the @da2/shared enum is covered so a
 * new vocabulary member is a compile error here, not a silent "Plan update".
 */
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
// View-state derivation (which screen state to render)
// ---------------------------------------------------------------------------

export type ProposalViewKind =
  | "proposed" // actionable diff
  | "no_changes" // positive "on track" empty state
  | "terminal"; // accepted / rejected / superseded / expired -> read-only

/**
 * Collapse a WeeklyReviewStatus into the three UI buckets. `proposed` is the
 * only actionable state; `no_changes` gets the on-track empty state; everything
 * else is a read-only terminal record.
 */
export function viewKindForStatus(status: WeeklyReviewStatus): ProposalViewKind {
  if (status === "proposed") return "proposed";
  if (status === "no_changes") return "no_changes";
  return "terminal";
}

/** Human-readable label for a terminal proposal's status badge. */
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
// Op-row presentation: before -> after
// ---------------------------------------------------------------------------

/** A single rendered op row's before/after/why, kind-agnostic for the UI. */
export interface OpRowView {
  opId: string;
  kind: EditOp["kind"];
  /** "Move" | "Adjust" | "Skip" | "Remove" | "Add" — the verb badge. */
  verb: string;
  /** Left side of the diff (what it is now). null for inserts. */
  before: string | null;
  /** Right side of the diff (what it becomes). */
  after: string;
  /** Per-op LLM reason ("why"), rendered as plain text. */
  reason: string;
  /**
   * The day this op affects, for date-sorting + a render-boundary timestamp.
   * YYYY-MM-DD. For move/insert this is the target day; otherwise the existing
   * day is unknown to the client (baseline carries no date), so null.
   */
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

/** Compact one-line summary of a StructureChange (for the "after" of a modify). */
export function describeStructureChange(c: StructureChange): string {
  const parts: string[] = [];
  if (c.duration_s != null) parts.push(fmtDuration(c.duration_s));
  if (c.load != null) parts.push(`${Math.round(c.load)} load`);
  if (c.intensity_target != null) parts.push(fmtIntensity(c.intensity_target));
  return parts.length > 0 ? parts.join(" · ") : "Updated";
}

/**
 * Format a YYYY-MM-DD scheduled-date at the render boundary in the athlete's
 * timezone (mirrors the formatWorkoutDateTime helper's intent for date-only
 * values). A bare date string has no time-of-day, so we anchor at local noon to
 * avoid a day-shift across timezones.
 */
export function formatScheduledDate(dateStr: string, timezone: string): string {
  const tz = timezone || "UTC";
  // Anchor at 12:00 UTC: a DATE has no instant; noon keeps the calendar day
  // stable for every IANA offset when projected into `tz`.
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
}

/** Project one ProposedEdit onto a kind-agnostic row for rendering. */
export function toOpRow(edit: ProposedEdit, timezone: string): OpRowView {
  const op = edit.op;
  const base: Pick<OpRowView, "opId" | "kind" | "reason"> = {
    opId: op.op_id,
    kind: op.kind,
    reason: op.reason,
  };
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
      return {
        ...base,
        verb: "Skip",
        before: "Scheduled",
        after: "Skip this session",
        targetDate: null,
      };
    case "delete":
      return {
        ...base,
        verb: "Remove",
        before: "Scheduled",
        after: "Remove from plan",
        targetDate: null,
      };
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

/**
 * All op rows for a proposal, sorted by target date ascending (rows without a
 * known date sink to the end, stable on op_id). The plan asks for the op list
 * "sorted by date".
 */
export function toOpRows(review: WeeklyReviewRow, timezone: string): OpRowView[] {
  return review.proposed_changes
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

/**
 * The reassurance callouts shown above the op list ("taper protected", "load
 * balance maintained"). v1 derives them deterministically from the trigger +
 * the op mix so they are honest without a dedicated server field: every
 * proposal passed the deterministic validator (Unit 5/6), so the load-balance
 * guarantee is always true; the taper line is shown when an event is in play.
 */
export function preservedInvariants(review: WeeklyReviewRow): string[] {
  const callouts = ["Load balance maintained"];
  if (review.event_date_snapshot != null || review.trigger_kind === "event_change") {
    callouts.push("Taper protected");
  }
  return callouts;
}

// ---------------------------------------------------------------------------
// Cherry-pick (modify) selection
// ---------------------------------------------------------------------------

export interface SelectionSummary {
  /** op-ids currently selected (the set sent to POST .../accept). */
  selectedIds: string[];
  selectedCount: number;
  totalCount: number;
  /** Primary CTA label: Accept all -> "Apply N changes" -> (none) Reject-only. */
  ctaLabel: string;
  /** When false, the only safe action is reject (no ops selected). */
  ctaEnabled: boolean;
}

/**
 * Derive the action-bar state from the live selection set. ops default to
 * all-selected (the caller seeds the set with every op_id); deselecting drives
 * the CTA: all -> "Accept all changes"; some -> "Apply N changes"; none ->
 * disabled (reject is the only remaining path).
 */
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
  return {
    selectedIds,
    selectedCount,
    totalCount,
    ctaLabel,
    ctaEnabled: selectedCount > 0,
  };
}

// ---------------------------------------------------------------------------
// Apply-result -> per-op outcome (stale-skip etc. after an accept)
// ---------------------------------------------------------------------------

export interface AppliedOutcome {
  opId: string;
  outcome: string;
  /** True iff the op did NOT apply (struck-through, with a reason). */
  skipped: boolean;
  /** Athlete-facing explanation for a non-applied op. */
  message: string | null;
}

/** Map one EditOpResult outcome to athlete-facing copy. */
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

/** Build per-op outcomes from the accept response's `results`. */
export function appliedOutcomes(results: EditOpResult[]): AppliedOutcome[] {
  return results.map((r) => {
    const skipped = r.outcome !== "applied";
    return {
      opId: r.op_id,
      outcome: r.outcome,
      skipped,
      message: skipped ? outcomeMessage(r.outcome) : null,
    };
  });
}

/**
 * True iff the apply ended `superseded` (a coupled proposal had a dropped/stale
 * op and was aborted whole) — the UI tells the athlete a fresh review is coming.
 */
export function wasSuperseded(status: string): boolean {
  return status === "superseded";
}

// ---------------------------------------------------------------------------
// Banner content (home / calendar "review ready" surface)
// ---------------------------------------------------------------------------

export interface ReviewBannerContent {
  reviewId: string;
  /** "Your plan was reviewed — N changes proposed" (+ trigger label). */
  headline: string;
  triggerLabel: string;
}

/**
 * The most relevant actionable proposal to surface in the banner (a single
 * `proposed` row), or null when nothing is pending. Picks the most recently
 * generated proposed proposal.
 */
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
  return {
    reviewId: top.id,
    headline,
    triggerLabel: triggerLabel(top.trigger_kind),
  };
}
