"use client";

import { useState } from "react";

export default function InviteSection({
  coachId,
  variant = "secondary",
}: {
  coachId: string;
  variant?: "primary" | "secondary";
}) {
  const [copied, setCopied] = useState(false);

  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/join/coach/${coachId}`
      : `/join/coach/${coachId}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — the link stays visible
      // for manual selection, so no further fallback is needed.
    }
  }

  const isPrimary = variant === "primary";

  return (
    <div
      style={{
        background: isPrimary ? "var(--color-paper)" : "var(--color-canvas-soft)",
        border: `1px solid ${isPrimary ? "var(--color-border)" : "transparent"}`,
        borderRadius: 16,
        padding: isPrimary ? "24px 26px" : "18px 22px",
      }}
    >
      <p className="eyebrow" style={{ marginBottom: isPrimary ? 8 : 6 }}>
        Invite athletes
      </p>
      {isPrimary && (
        <p
          style={{
            fontSize: 14,
            color: "var(--color-ink-muted)",
            lineHeight: 1.55,
            margin: "0 0 16px",
            maxWidth: 460,
          }}
        >
          Share this link with an athlete. When they open it and sign in, they&apos;re added
          to your roster and you&apos;ll see their training here.
        </p>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <code
          style={{
            flex: "1 1 240px",
            minWidth: 0,
            padding: "10px 13px",
            borderRadius: 10,
            background: isPrimary ? "var(--color-canvas-soft)" : "var(--color-paper)",
            border: "1px solid var(--color-border)",
            fontSize: 12.5,
            fontFamily: "var(--font-mono)",
            color: "var(--color-ink-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {inviteUrl}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          aria-live="polite"
          style={{
            flexShrink: 0,
            padding: "10px 18px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            border: `1px solid ${copied ? "var(--color-success)" : "var(--color-ink)"}`,
            background: copied ? "var(--color-success)" : "var(--color-ink)",
            color: "#fff",
            transition: "background-color 150ms ease, border-color 150ms ease",
            whiteSpace: "nowrap",
          }}
        >
          {copied ? "Copied ✓" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
