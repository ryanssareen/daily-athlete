"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MarkAsDoneButton({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  async function handleMarkDone() {
    setState("loading");
    setErrMsg("");
    try {
      const res = await fetch(`/api/workouts/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrMsg((body as { error?: string }).error ?? "Could not mark as done");
        setState("error");
        return;
      }
      router.refresh();
      // Stay in 'loading' until the server component re-renders and removes this button.
    } catch {
      setErrMsg("Network error");
      setState("error");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      <button
        onClick={handleMarkDone}
        disabled={state === "loading"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "9px 20px",
          borderRadius: 999,
          fontSize: 14,
          fontWeight: 600,
          cursor: state === "loading" ? "not-allowed" : "pointer",
          border: "none",
          background: state === "loading" ? "var(--color-canvas-soft)" : "var(--color-pine)",
          color: state === "loading" ? "var(--color-ink-muted)" : "#fff",
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
            Saving…
          </>
        ) : (
          <>✓ Mark as done</>
        )}
      </button>
      {state === "error" && (
        <span
          style={{
            fontSize: 12,
            color: "var(--color-danger)",
            background: "color-mix(in oklab, var(--color-danger) 10%, transparent)",
            border: "1px solid color-mix(in oklab, var(--color-danger) 25%, transparent)",
            borderRadius: 8,
            padding: "4px 10px",
            display: "block",
          }}
        >
          {errMsg}
        </span>
      )}
    </div>
  );
}
