"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JoinButton({ coachId }: { coachId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "joining" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleJoin() {
    setStatus("joining");
    setErrorMsg("");
    try {
      const res = await fetch("/api/join/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coachId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg((body as { error?: string }).error ?? "Something went wrong");
        setStatus("error");
        return;
      }
      router.push("/athlete");
    } catch {
      setErrorMsg("Network error — please try again");
      setStatus("error");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        onClick={handleJoin}
        disabled={status === "joining"}
        style={{
          padding: "12px 28px",
          borderRadius: 999,
          fontSize: 15,
          fontWeight: 600,
          cursor: status === "joining" ? "not-allowed" : "pointer",
          border: "none",
          background: status === "joining" ? "var(--color-canvas-soft)" : "var(--color-ink)",
          color: status === "joining" ? "var(--color-ink-muted)" : "var(--color-paper)",
          transition: "all 0.12s",
        }}
      >
        {status === "joining" ? "Joining…" : "Join roster"}
      </button>
      {status === "error" && (
        <p style={{ fontSize: 13, color: "var(--color-danger)", margin: 0 }}>{errorMsg}</p>
      )}
    </div>
  );
}
