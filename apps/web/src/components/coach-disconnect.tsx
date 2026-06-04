"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserMinus } from "lucide-react";

/**
 * Athlete-side "leave my coach" control for Settings → Coach.
 *
 * Two-step inline confirm (no browser dialog) because disconnecting ends the
 * coaching relationship and the athlete must be re-invited to undo it. On
 * success it calls router.refresh() so the server-rendered Coach card re-reads
 * its data and flips to the "No coach linked" state.
 */
export function CoachDisconnect({ coachName }: { coachName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDisconnect() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/athlete/coach/disconnect", { method: "POST" });
        if (!res.ok && res.status !== 204) {
          throw new Error(`Disconnect failed (${res.status})`);
        }
        setConfirming(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Disconnect failed");
      }
    });
  }

  if (!confirming) {
    return (
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          style={{
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
            transition: "border-color 160ms ease, color 160ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--color-danger)";
            e.currentTarget.style.color = "var(--color-danger)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--color-border-strong)";
            e.currentTarget.style.color = "var(--color-ink-muted)";
          }}
        >
          <UserMinus size={14} strokeWidth={1.75} />
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <p
        style={{
          fontSize: 13,
          color: "var(--color-ink)",
          margin: "0 0 10px",
          lineHeight: 1.5,
        }}
      >
        Disconnect from <strong>{coachName}</strong>? They&apos;ll lose access to your
        training data. You can be re-invited with a new link later.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={isPending}
          style={{
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
            transition: "opacity 160ms ease",
          }}
        >
          {isPending ? (
            <Loader2 size={14} strokeWidth={1.75} style={{ animation: "spin 0.8s linear infinite" }} />
          ) : (
            <UserMinus size={14} strokeWidth={1.75} />
          )}
          {isPending ? "Disconnecting…" : "Yes, disconnect"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={isPending}
          style={{
            padding: "8px 16px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 500,
            cursor: isPending ? "not-allowed" : "pointer",
            border: "1px solid var(--color-border-strong)",
            background: "transparent",
            color: "var(--color-ink-muted)",
          }}
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
