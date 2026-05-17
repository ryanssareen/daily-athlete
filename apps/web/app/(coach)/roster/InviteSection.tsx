"use client";

import { useState } from "react";

export default function InviteSection({ coachId }: { coachId: string }) {
  const [copied, setCopied] = useState(false);

  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/join/coach/${coachId}`
      : `/join/coach/${coachId}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(
        typeof window !== "undefined"
          ? `${window.location.origin}/join/coach/${coachId}`
          : `/join/coach/${coachId}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select the input
    }
  }

  return (
    <div
      style={{
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 16,
        padding: "20px 24px",
        marginBottom: 32,
      }}
    >
      <p
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--color-ink-muted)",
          marginBottom: 10,
        }}
      >
        Invite athletes
      </p>
      <p style={{ fontSize: 13, color: "var(--color-ink-muted)", marginBottom: 14 }}>
        Share this link with athletes. When they open it and sign in, they&apos;ll be added to your roster.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <code
          style={{
            flex: 1,
            padding: "9px 12px",
            borderRadius: 10,
            background: "var(--color-canvas-soft)",
            border: "1px solid var(--color-border)",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            color: "var(--color-ink-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            display: "block",
          }}
        >
          {inviteUrl}
        </code>
        <button
          onClick={handleCopy}
          style={{
            flexShrink: 0,
            padding: "9px 16px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            border: "1px solid var(--color-border)",
            background: copied ? "var(--color-pine)" : "var(--color-paper)",
            color: copied ? "#fff" : "var(--color-ink)",
            transition: "all 0.15s",
            whiteSpace: "nowrap",
          }}
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
