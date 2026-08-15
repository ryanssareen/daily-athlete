"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2, Trash2 } from "lucide-react";

import type { PlanRow } from "@da2/shared";

export interface PlanApi {
  archive: (id: string) => Promise<void>;
  softDelete: (id: string) => Promise<void>;
}

export const defaultPlanApi: PlanApi = {
  async archive(id) {
    const res = await fetch(`/api/plans/${id}/archive`, { method: "PATCH" });
    if (!res.ok) throw new Error(`Archive failed (${res.status})`);
  },
  async softDelete(id) {
    const res = await fetch(`/api/plans/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Delete failed (${res.status})`);
    }
  },
};

type Action = "archive" | "delete";

/**
 * Archive/delete controls for a plan detail page. Two-step inline confirm
 * (no browser dialog), mirroring @/components/coach-disconnect.tsx: a
 * neutral button flips to a warning + confirm/cancel pair. On failure the
 * confirm step stays visible with an inline retryable error rather than
 * silently reverting.
 *
 * An already-archived plan shows only Delete -- Archive would be a no-op
 * from here.
 */
export function PlanActions({
  plan,
  isCurrentActivePlan,
  hasUpcomingWorkouts,
  api = defaultPlanApi,
}: {
  plan: Pick<PlanRow, "id" | "status">;
  /** True when this is the athlete's current active plan. */
  isCurrentActivePlan: boolean;
  /** True when the plan has not-yet-done workouts still on the calendar. */
  hasUpcomingWorkouts: boolean;
  api?: PlanApi;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function runAction(action: Action) {
    setError(null);
    startTransition(async () => {
      try {
        if (action === "archive") {
          await api.archive(plan.id);
        } else {
          await api.softDelete(plan.id);
        }
        setPendingAction(null);
        router.push("/plans");
        router.refresh();
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : `${action === "archive" ? "Archive" : "Delete"} failed`
        );
      }
    });
  }

  if (!pendingAction) {
    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {plan.status === "active" && (
          <button
            type="button"
            onClick={() => setPendingAction("archive")}
            style={neutralButtonStyle}
          >
            <Archive size={14} strokeWidth={1.75} />
            Archive
          </button>
        )}
        <button
          type="button"
          onClick={() => setPendingAction("delete")}
          style={neutralButtonStyle}
        >
          <Trash2 size={14} strokeWidth={1.75} />
          Delete
        </button>
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--color-ink)", margin: "0 0 10px", lineHeight: 1.5 }}>
        {pendingAction === "archive"
          ? "Archive this plan? It'll stay in your history but stop being your active plan."
          : "Delete this plan? It'll be removed from your history."}
        {isCurrentActivePlan && (
          <>
            {" "}
            This is your current plan — {pendingAction === "archive" ? "archiving" : "deleting"}{" "}
            it will leave you without an active plan until you generate a new one.
          </>
        )}
        {hasUpcomingWorkouts && (
          <> Its upcoming scheduled workouts will also be removed from your calendar.</>
        )}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => runAction(pendingAction)}
          disabled={isPending}
          style={dangerButtonStyle(isPending)}
        >
          {isPending ? (
            <Loader2 size={14} strokeWidth={1.75} style={{ animation: "spin 0.8s linear infinite" }} />
          ) : pendingAction === "archive" ? (
            <Archive size={14} strokeWidth={1.75} />
          ) : (
            <Trash2 size={14} strokeWidth={1.75} />
          )}
          {isPending
            ? pendingAction === "archive"
              ? "Archiving…"
              : "Deleting…"
            : pendingAction === "archive"
              ? "Yes, archive"
              : "Yes, delete"}
        </button>
        <button
          type="button"
          onClick={() => {
            setPendingAction(null);
            setError(null);
          }}
          disabled={isPending}
          style={cancelButtonStyle(isPending)}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p style={{ fontSize: 12, color: "var(--color-danger)", margin: "10px 0 0" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const neutralButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 16px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  border: "1px solid var(--color-border-strong)",
  background: "transparent",
  color: "var(--color-ink-muted)",
};

function dangerButtonStyle(isPending: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 16px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 500,
    cursor: isPending ? "wait" : "pointer",
    border: "1px solid var(--color-danger)",
    background: "var(--color-danger)",
    color: "#fff",
    opacity: isPending ? 0.6 : 1,
  };
}

function cancelButtonStyle(isPending: boolean): CSSProperties {
  return {
    padding: "8px 16px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 500,
    cursor: isPending ? "not-allowed" : "pointer",
    border: "1px solid var(--color-border-strong)",
    background: "transparent",
    color: "var(--color-ink-muted)",
  };
}
