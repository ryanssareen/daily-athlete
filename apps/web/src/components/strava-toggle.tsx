"use client";

import { useState, useTransition } from "react";
import { Link2, Link2Off, Loader2 } from "lucide-react";

interface StravaToggleProps {
  initialConnected: boolean;
}

export function StravaToggle({ initialConnected }: StravaToggleProps) {
  const [connected, setConnected] = useState(initialConnected);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDisconnect() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/integrations/strava/disconnect", {
          method: "POST",
        });
        if (!res.ok && res.status !== 204) {
          throw new Error(`Disconnect failed (${res.status})`);
        }
        setConnected(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Disconnect failed");
      }
    });
  }

  function handleConnect() {
    // OAuth requires a full redirect to Strava's authorization page.
    window.location.href = "/api/integrations/strava/authorize";
  }

  const Icon = isPending ? Loader2 : connected ? Link2Off : Link2;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        {/* Status indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: connected ? "var(--color-pine)" : "var(--color-border-strong)",
              display: "inline-block",
              transition: "background 240ms ease",
            }}
          />
          <p
            style={{
              fontSize: 14,
              color: "var(--color-ink)",
              margin: 0,
              fontWeight: 500,
              transition: "color 240ms ease",
            }}
          >
            {connected ? "Connected to Strava" : "Not connected"}
          </p>
        </div>

        {/* Toggle button — animates like the theme toggle */}
        <button
          type="button"
          onClick={connected ? handleDisconnect : handleConnect}
          disabled={isPending}
          aria-label={connected ? "Disconnect Strava" : "Connect Strava"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 18px",
            borderRadius: 999,
            fontSize: 14,
            fontWeight: 500,
            cursor: isPending ? "wait" : "pointer",
            border: connected
              ? "1px solid var(--color-border-strong)"
              : "1px solid transparent",
            background: connected ? "transparent" : "#FC4C02",
            color: connected ? "var(--color-ink-muted)" : "#fff",
            transition:
              "background 240ms ease, color 240ms ease, border-color 240ms ease, opacity 240ms ease",
            opacity: isPending ? 0.6 : 1,
          }}
          onMouseEnter={(e) => {
            if (isPending) return;
            const el = e.currentTarget;
            if (connected) {
              el.style.borderColor = "var(--color-danger)";
              el.style.color = "var(--color-danger)";
            } else {
              el.style.background = "#e04400";
            }
          }}
          onMouseLeave={(e) => {
            if (isPending) return;
            const el = e.currentTarget;
            if (connected) {
              el.style.borderColor = "var(--color-border-strong)";
              el.style.color = "var(--color-ink-muted)";
            } else {
              el.style.background = "#FC4C02";
            }
          }}
        >
          <Icon
            size={14}
            strokeWidth={1.75}
            style={{
              animation: isPending ? "spin 0.8s linear infinite" : "none",
            }}
          />
          <span
            style={{
              display: "inline-block",
              transition: "opacity 200ms ease",
            }}
          >
            {isPending
              ? connected
                ? "Disconnecting…"
                : "Connecting…"
              : connected
                ? "Disconnect"
                : "Connect Strava"}
          </span>
        </button>
      </div>

      {error && (
        <p
          style={{
            fontSize: 12,
            color: "var(--color-danger)",
            margin: 0,
          }}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
