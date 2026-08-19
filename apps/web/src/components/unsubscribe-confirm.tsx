"use client";

// The explicit confirm on the unsubscribe page (U8).
//
// The click is what performs the change. See /api/unsubscribe's header: mail
// clients and link scanners pre-fetch email URLs, so a bare GET that mutated
// state would silently unsubscribe athletes on their provider's behalf.

import { useState } from "react";

type Phase = "idle" | "working" | "done" | "invalid" | "error";

export function UnsubscribeConfirm({
  token,
  cadenceLabel,
}: {
  token: string;
  cadenceLabel: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");

  async function confirm() {
    setPhase("working");
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        setPhase("done");
        return;
      }
      setPhase(res.status === 400 ? "invalid" : "error");
    } catch {
      setPhase("error");
    }
  }

  if (phase === "done") {
    return (
      <div>
        <p style={{ marginTop: 12, fontSize: 15, color: "var(--color-ink, #111)" }}>
          Done — you won&apos;t receive the {cadenceLabel} review by email any more.
        </p>
        <p style={{ marginTop: 8, fontSize: 14, color: "var(--color-ink-muted, #666)" }}>
          Your reviews are still in the app under Reports, and you can turn email back on any time
          in Settings.
        </p>
      </div>
    );
  }

  if (phase === "invalid") {
    return (
      <p style={{ marginTop: 12, fontSize: 15, color: "var(--color-ink-muted, #666)" }}>
        This unsubscribe link is no longer valid. You can turn off {cadenceLabel} emails in the app
        under Settings.
      </p>
    );
  }

  return (
    <div>
      <p style={{ marginTop: 12, fontSize: 15, color: "var(--color-ink, #111)" }}>
        Stop sending the {cadenceLabel} training review to this address?
      </p>
      <p style={{ marginTop: 8, fontSize: 14, color: "var(--color-ink-muted, #666)" }}>
        Your reviews stay available in the app — this only turns off the email.
      </p>

      {phase === "error" && (
        <p style={{ marginTop: 12, fontSize: 14, color: "var(--color-ink-muted, #666)" }}>
          Something went wrong. Please try again.
        </p>
      )}

      <button
        type="button"
        onClick={confirm}
        disabled={phase === "working"}
        style={{
          marginTop: 20,
          appearance: "none",
          border: "1px solid var(--color-border, #e5e5e5)",
          background: "var(--color-clay-soft, #f3efe9)",
          color: "var(--color-clay-deep, #6b4f3a)",
          borderRadius: 10,
          padding: "10px 18px",
          fontSize: 15,
          fontWeight: 500,
          cursor: phase === "working" ? "default" : "pointer",
        }}
      >
        {phase === "working" ? "Unsubscribing…" : `Unsubscribe from ${cadenceLabel} emails`}
      </button>
    </div>
  );
}
