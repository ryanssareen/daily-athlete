"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SyncButton({ workoutId }: { workoutId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  async function handleSync() {
    setState("loading");
    setErrMsg("");
    try {
      const res = await fetch("/api/integrations/strava/sync-workout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrMsg((body as { error?: string }).error ?? "Sync failed");
        setState("error");
        return;
      }
      router.refresh();
      setState("idle");
    } catch {
      setErrMsg("Network error");
      setState("error");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      <button
        onClick={handleSync}
        disabled={state === "loading"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 14px",
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          cursor: state === "loading" ? "not-allowed" : "pointer",
          border: "1px solid var(--color-border)",
          background: state === "loading" ? "var(--color-canvas-soft)" : "var(--color-paper)",
          color: state === "loading" ? "var(--color-ink-muted)" : "var(--color-ink)",
          transition: "all 0.12s",
        }}
      >
        {state === "loading" ? (
          <>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                border: "2px solid var(--color-border)",
                borderTopColor: "var(--color-ink-muted)",
                animation: "spin 0.7s linear infinite",
              }}
            />
            Syncing…
          </>
        ) : (
          <>↻ Sync from Strava</>
        )}
      </button>
      {state === "error" && (
        <span style={{ fontSize: 11, color: "var(--color-danger)" }}>{errMsg}</span>
      )}
    </div>
  );
}
