"use client";

// The propose-then-confirm review surface (Unit 11), shared by the athlete web
// page and the coach proposal view. A thin React shell over the pure helpers in
// proposal-view.ts: it owns fetch (GET), the Realtime subscription
// (reconnect-and-refetch), the cherry-pick selection set, and the accept/reject
// calls. All copy/decision logic lives in proposal-view.ts so it is unit-tested
// under the Node vitest env.
//
// Responsive: ≥768px two-column (op list | detail rail); <768px stacked. The
// action bar is sticky-bottom. We detect the breakpoint with a resize listener
// (no CSS-module/Tailwind class system is in use here — the app styles inline).
//
// States (all required by the plan): loading skeleton, error (CTA re-enables,
// inline "your plan is unchanged", selection preserved), stale-skip inline,
// no_changes on-track, lapsed read-only + upsell.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EditOpResult, WeeklyReviewRow } from "@da2/shared";

import { createClient } from "@/auth/supabase";
import { subscribeToWeeklyReviews } from "@/realtime/weekly-reviews";
import {
  appliedOutcomes,
  bannerFor,
  preservedInvariants,
  selectionSummary,
  terminalStatusLabel,
  toOpRows,
  triggerLabel,
  viewKindForStatus,
  wasSuperseded,
  type AppliedOutcome,
} from "./proposal-view";

// --- Fetch seams (overridable in tests; default to the typed API client) -----

export interface ProposalApi {
  list: () => Promise<WeeklyReviewRow[]>;
  get: (id: string) => Promise<WeeklyReviewRow>;
  accept: (
    id: string,
    opIds: string[]
  ) => Promise<{ status: string; superseded: boolean; results: EditOpResult[] } | { lapsed: true }>;
  reject: (id: string) => Promise<{ status: string }>;
}

async function parseJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export const defaultProposalApi: ProposalApi = {
  async list() {
    const res = await fetch("/api/weekly-review", {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`list failed: ${res.status}`);
    const body = (await parseJson(res)) as { proposals?: WeeklyReviewRow[] } | null;
    return body?.proposals ?? [];
  },
  async get(id) {
    const res = await fetch(`/api/weekly-review/${id}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`get failed: ${res.status}`);
    const body = (await parseJson(res)) as { proposal?: WeeklyReviewRow } | null;
    if (!body?.proposal) throw new Error("get returned no proposal");
    return body.proposal;
  },
  async accept(id, opIds) {
    const res = await fetch(`/api/weekly-review/${id}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op_ids: opIds }),
    });
    if (res.status === 402) return { lapsed: true };
    if (!res.ok) throw new Error(`accept failed: ${res.status}`);
    const body = (await parseJson(res)) as {
      status: string;
      superseded: boolean;
      results: EditOpResult[];
    };
    return body;
  },
  async reject(id) {
    const res = await fetch(`/api/weekly-review/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`reject failed: ${res.status}`);
    const body = (await parseJson(res)) as { status: string };
    return body;
  },
};

// --- Small style helpers (match the inline-style design system) --------------

const card: React.CSSProperties = {
  background: "var(--color-paper)",
  border: "1px solid var(--color-border)",
  borderRadius: 16,
};

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "ai" | "warn" }) {
  const cfg =
    tone === "ai"
      ? {
          bg: "color-mix(in oklab, var(--color-clay) 15%, transparent)",
          color: "var(--color-clay-deep)",
          border: "1px solid color-mix(in oklab, var(--color-clay) 30%, transparent)",
        }
      : tone === "warn"
        ? {
            bg: "var(--color-danger-soft)",
            color: "var(--color-danger)",
            border: "1px solid color-mix(in oklab, var(--color-danger) 30%, transparent)",
          }
        : {
            bg: "var(--color-canvas-soft)",
            color: "var(--color-ink-muted)",
            border: "1px solid var(--color-border)",
          };
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.02em",
        ...cfg,
      }}
    >
      {children}
    </span>
  );
}

// --- Props -------------------------------------------------------------------

export interface ProposalReviewProps {
  /** The athlete whose proposals we view (drives the realtime filter). */
  athleteId: string;
  /** Optional specific proposal id (deep link / coach selecting a row). */
  reviewId?: string;
  /**
   * "coach" tweaks copy ("on the athlete's behalf"); accept-authority is
   * enforced server-side regardless.
   */
  actor?: "athlete" | "coach";
  /** Test seam: inject a mocked API + skip the realtime subscription. */
  api?: ProposalApi;
  /** Test seam: disable the realtime subscription (defaults on). */
  disableRealtime?: boolean;
  /** Timezone for render-boundary date formatting. */
  timezone?: string;
}

type LoadPhase = "loading" | "ready" | "error";

export default function ProposalReview({
  athleteId,
  reviewId,
  actor = "athlete",
  api = defaultProposalApi,
  disableRealtime = false,
  timezone = "UTC",
}: ProposalReviewProps) {
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [review, setReview] = useState<WeeklyReviewRow | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Cherry-pick selection (default all-selected once a proposal loads).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const seededFor = useRef<string | null>(null);

  // Action state.
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [outcomes, setOutcomes] = useState<AppliedOutcome[] | null>(null);
  const [lapsed, setLapsed] = useState(false);
  const [supersededNotice, setSupersededNotice] = useState(false);

  const refetch = useCallback(async () => {
    try {
      let next: WeeklyReviewRow | null = null;
      if (reviewId) {
        next = await api.get(reviewId);
      } else {
        // Scope the list to this surface's athlete (the coach GET returns the
        // coach's own + every linked athlete's proposals; filter to the one in
        // view). For the athlete surface athleteId === their own id.
        const all = (await api.list()).filter((p) => p.athlete_id === athleteId);
        const banner = bannerFor(all);
        next =
          (banner ? all.find((p) => p.id === banner.reviewId) : null) ??
          // Fall back to the most recent proposal of any status (so a terminal /
          // no_changes record still renders rather than a blank screen).
          [...all].sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1))[0] ??
          null;
      }
      setReview(next);
      setLoadError(false);
      setPhase("ready");
    } catch {
      setLoadError(true);
      setPhase("error");
    }
  }, [api, reviewId, athleteId]);

  // Initial fetch.
  useEffect(() => {
    setPhase("loading");
    void refetch();
  }, [refetch]);

  // Seed the selection to all-ops whenever a fresh proposed proposal loads.
  useEffect(() => {
    if (review && review.status === "proposed" && seededFor.current !== review.id) {
      setSelected(new Set(review.proposed_changes.map((e) => e.op.op_id)));
      seededFor.current = review.id;
    }
  }, [review]);

  // Realtime: reconnect-and-refetch. We also refetch on tab focus (the
  // browser equivalent of mobile foreground) so a dropped socket self-heals.
  useEffect(() => {
    if (disableRealtime || typeof window === "undefined") return;
    const client = createClient();
    const unsub = subscribeToWeeklyReviews(client, {
      athleteId,
      onChange: () => {
        void refetch();
      },
    });
    const onFocus = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [athleteId, disableRealtime, refetch]);


  const rows = useMemo(
    () => (review ? toOpRows(review, timezone) : []),
    [review, timezone]
  );
  const allOpIds = useMemo(() => rows.map((r) => r.opId), [rows]);
  const summary = useMemo(() => selectionSummary(allOpIds, selected), [allOpIds, selected]);
  const outcomeByOp = useMemo(() => {
    const m = new Map<string, AppliedOutcome>();
    for (const o of outcomes ?? []) m.set(o.opId, o);
    return m;
  }, [outcomes]);

  function toggleOp(opId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(opId)) next.delete(opId);
      else next.add(opId);
      return next;
    });
  }

  async function onAccept() {
    if (!review || summary.selectedCount === 0) return;
    setSubmitting(true);
    setActionError(false);
    try {
      const res = await api.accept(review.id, summary.selectedIds);
      if ("lapsed" in res) {
        setLapsed(true);
        return;
      }
      setOutcomes(appliedOutcomes(res.results));
      if (wasSuperseded(res.status)) setSupersededNotice(true);
      // Re-read the (now terminal) proposal so the surface reflects the new state.
      await refetch();
    } catch {
      // Error: CTA re-enables, selections preserved, plan unchanged.
      setActionError(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function onReject() {
    if (!review) return;
    setSubmitting(true);
    setActionError(false);
    try {
      await api.reject(review.id);
      await refetch();
    } catch {
      setActionError(true);
    } finally {
      setSubmitting(false);
    }
  }

  // ----- Render states -------------------------------------------------------

  if (phase === "loading") {
    return <LoadingSkeleton />;
  }

  if (phase === "error" && loadError) {
    return (
      <div style={{ ...card, padding: "40px 32px", textAlign: "center" }}>
        <p style={{ fontSize: 15, color: "var(--color-ink)", margin: 0 }}>
          We couldn&apos;t load your review.
        </p>
        <p style={{ fontSize: 13, color: "var(--color-ink-muted)", margin: "8px 0 16px" }}>
          Your plan is unchanged.
        </p>
        <button onClick={() => void refetch()} style={primaryBtn(false)} data-testid="retry-load">
          Try again
        </button>
      </div>
    );
  }

  if (!review) {
    return (
      <div style={{ ...card, padding: "40px 32px", textAlign: "center" }}>
        <p style={{ fontSize: 15, color: "var(--color-ink-muted)", margin: 0 }}>
          No reviews yet. We&apos;ll let you know when your plan is reviewed.
        </p>
      </div>
    );
  }

  const view = viewKindForStatus(review.status);

  // no_changes: positive on-track empty state, no action controls.
  if (view === "no_changes") {
    return (
      <div style={{ ...card, padding: "40px 32px", textAlign: "center" }} data-testid="state-no-changes">
        <p style={{ fontSize: 22, margin: 0 }}>✓</p>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--color-ink)", margin: "8px 0 4px" }}>
          Reviewed — you&apos;re on track
        </h2>
        <p style={{ fontSize: 13, color: "var(--color-ink-muted)", margin: 0 }}>
          {triggerLabel(review.trigger_kind)} · {review.generated_at.slice(0, 10)}
        </p>
      </div>
    );
  }

  const isActionable = view === "proposed" && !lapsed;
  const invariants = preservedInvariants(review);

  // ----- Header (page hierarchy: trigger label -> narrative -> callouts) ------

  const header = (
    <div style={{ marginBottom: 20 }}>
      <p className="eyebrow" style={{ marginBottom: 6 }}>
        {triggerLabel(review.trigger_kind)}
      </p>
      <h1
        style={{
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: "var(--color-ink)",
          margin: 0,
        }}
      >
        {view === "terminal"
          ? terminalStatusLabel(review.status)
          : actor === "coach"
            ? "Review proposed for your athlete"
            : "Your plan was reviewed"}
      </h1>
      {review.narrative && (
        <p style={{ fontSize: 15, color: "var(--color-ink-muted)", margin: "10px 0 0", lineHeight: 1.5 }}>
          {/* Untrusted LLM string -> plain text only (no HTML/markdown). */}
          {review.narrative}
        </p>
      )}
      {actor === "coach" && isActionable && (
        <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", margin: "8px 0 0" }}>
          You are accepting on the athlete&apos;s behalf.
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        {invariants.map((c) => (
          <Badge key={c}>✓ {c}</Badge>
        ))}
      </div>
    </div>
  );

  // ----- Op list -------------------------------------------------------------

  const opList = (
    <div style={{ ...card, overflow: "hidden" }} data-testid="op-list">
      {rows.map((r, i) => {
        const outcome = outcomeByOp.get(r.opId);
        const struck = outcome?.skipped ?? false;
        const checked = selected.has(r.opId);
        return (
          <div
            key={r.opId}
            data-testid={`op-row-${r.opId}`}
            style={{
              display: "flex",
              gap: 12,
              padding: "14px 18px",
              borderBottom: i < rows.length - 1 ? "1px solid var(--color-border)" : "none",
              opacity: struck ? 0.6 : 1,
            }}
          >
            {isActionable && (
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleOp(r.opId)}
                aria-label={`Include ${r.verb.toLowerCase()} change`}
                data-testid={`op-toggle-${r.opId}`}
                style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0, cursor: "pointer" }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Badge tone="ai">{r.verb}</Badge>
                {r.targetDate && (
                  <span style={{ fontSize: 12, color: "var(--color-ink-subtle)", fontFamily: "var(--font-mono)" }}>
                    {r.targetDate}
                  </span>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 14,
                  color: "var(--color-ink)",
                  textDecoration: struck ? "line-through" : "none",
                }}
              >
                {r.before && (
                  <>
                    <span style={{ color: "var(--color-ink-subtle)" }}>{r.before}</span>
                    <span style={{ color: "var(--color-border-strong)" }}>→</span>
                  </>
                )}
                <span style={{ fontWeight: 500 }}>{r.after}</span>
              </div>
              <p style={{ fontSize: 13, color: "var(--color-ink-muted)", margin: "4px 0 0", lineHeight: 1.4 }}>
                {r.reason}
              </p>
              {struck && outcome?.message && (
                <p
                  data-testid={`op-skip-${r.opId}`}
                  style={{ fontSize: 12, color: "var(--color-danger)", margin: "6px 0 0", fontWeight: 500 }}
                >
                  {outcome.message}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ----- Action bar (sticky-bottom) ------------------------------------------

  const actionBar = isActionable ? (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        marginTop: 16,
        padding: "14px 18px",
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        boxShadow: "0 -2px 12px color-mix(in oklab, var(--color-ink) 6%, transparent)",
      }}
    >
      <span style={{ fontSize: 13, color: "var(--color-ink-muted)" }} data-testid="selection-summary">
        {summary.selectedCount} of {summary.totalCount} changes selected
      </span>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => void onReject()} disabled={submitting} style={secondaryBtn(submitting)} data-testid="reject-btn">
          Reject
        </button>
        <button
          onClick={() => void onAccept()}
          disabled={submitting || !summary.ctaEnabled}
          style={primaryBtn(submitting || !summary.ctaEnabled)}
          data-testid="accept-btn"
        >
          {submitting ? "Applying…" : summary.ctaLabel}
        </button>
      </div>
    </div>
  ) : null;

  // ----- Lapsed entitlement: full diff + upsell instead of action bar --------

  const lapsedBar = lapsed ? (
    <div
      data-testid="state-lapsed"
      style={{
        marginTop: 16,
        padding: "16px 18px",
        background: "var(--color-canvas-soft)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
      }}
    >
      <p style={{ fontSize: 14, color: "var(--color-ink)", margin: "0 0 4px", fontWeight: 600 }}>
        Renew to apply these changes
      </p>
      <p style={{ fontSize: 13, color: "var(--color-ink-muted)", margin: "0 0 12px" }}>
        Your AI plans subscription has lapsed. You can still see what was proposed, but applying changes
        needs an active plan.
      </p>
      <a href="/athlete/settings" style={primaryLinkBtn()}>
        Renew to apply
      </a>
    </div>
  ) : null;

  // ----- Notices -------------------------------------------------------------

  const notices = (
    <>
      {actionError && (
        <div
          data-testid="state-action-error"
          style={{
            marginBottom: 12,
            padding: "12px 16px",
            background: "var(--color-danger-soft)",
            border: "1px solid color-mix(in oklab, var(--color-danger) 30%, transparent)",
            borderRadius: 12,
            fontSize: 13,
            color: "var(--color-danger)",
          }}
        >
          Something went wrong — your plan is unchanged, try again.
        </div>
      )}
      {supersededNotice && (
        <div
          data-testid="state-superseded"
          style={{
            marginBottom: 12,
            padding: "12px 16px",
            background: "var(--color-canvas-soft)",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            fontSize: 13,
            color: "var(--color-ink-muted)",
          }}
        >
          Some of your plan changed while we were applying this — a fresh review is on its way.
        </div>
      )}
    </>
  );

  // ----- Layout (responsive via CSS) -----------------------------------------

  if (rows.length === 0) {
    return (
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        {header}
        {notices}
        {opList}
        {actionBar}
        {lapsedBar}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <style>{`
        .proposal-layout {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .proposal-detail-rail {
          display: none;
        }
        @media (min-width: 768px) {
          .proposal-layout {
            display: grid;
            grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
            align-items: start;
          }
          .proposal-detail-rail {
            display: block;
          }
        }
      `}</style>
      {header}
      {notices}
      <div className="proposal-layout">
        <div>
          {opList}
          {actionBar}
          {lapsedBar}
        </div>
        <div className="proposal-detail-rail">
          <DetailRail review={review} invariants={invariants} timezone={timezone} />
        </div>
      </div>
    </div>
  );
}

// --- Sub-views ---------------------------------------------------------------

function DetailRail({
  review,
  invariants,
  timezone,
}: {
  review: WeeklyReviewRow;
  invariants: string[];
  timezone: string;
}) {
  return (
    <div style={{ ...card, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <p className="eyebrow" style={{ marginBottom: 6 }}>
          What stayed safe
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {invariants.map((c) => (
            <span key={c} style={{ fontSize: 13, color: "var(--color-ink)" }}>
              ✓ {c}
            </span>
          ))}
        </div>
      </div>
      <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
        <p className="eyebrow" style={{ marginBottom: 6 }}>
          Reviewed
        </p>
        <p style={{ fontSize: 13, color: "var(--color-ink-muted)", margin: 0, fontFamily: "var(--font-mono)" }}>
          {review.generated_at.slice(0, 10)} ({timezone})
        </p>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div data-testid="state-loading" style={{ maxWidth: 680, margin: "0 auto" }}>
      <div style={{ height: 28, width: 220, borderRadius: 8, background: "var(--color-canvas-soft)", marginBottom: 18 }} />
      <div style={{ ...card, overflow: "hidden" }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              padding: "16px 18px",
              borderBottom: i < 2 ? "1px solid var(--color-border)" : "none",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ height: 14, width: "40%", borderRadius: 6, background: "var(--color-canvas-soft)" }} />
            <div style={{ height: 12, width: "70%", borderRadius: 6, background: "var(--color-canvas-soft)" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Button styles -----------------------------------------------------------

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 18px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    background: disabled ? "var(--color-canvas-soft)" : "var(--color-ink)",
    color: disabled ? "var(--color-ink-subtle)" : "var(--color-canvas)",
  };
}

function primaryLinkBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "9px 18px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
    background: "var(--color-ink)",
    color: "var(--color-canvas)",
  };
}

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 18px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    background: "var(--color-paper)",
    border: "1px solid var(--color-border)",
    color: "var(--color-ink-muted)",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
