"use client";

// The light/dark picker used by both the athlete and coach settings pages.
// Shared so the instant-apply behavior (see theme-button.tsx) and the
// active-state styling live in one place instead of two copies drifting.

import { useState } from "react";

import { ThemeButton } from "./theme-button";

const LABEL: Record<"light" | "dark", string> = {
  light: "☀️ Light",
  dark: "🌙 Dark",
};

export function AppearanceThemeButtons({
  initialTheme,
  fullWidth = false,
}: {
  initialTheme: string;
  /** Athlete settings fills the row (flex: 1 each); coach settings uses
   *  auto-width pills. Same active/inactive styling either way. */
  fullWidth?: boolean;
}) {
  const [theme, setTheme] = useState(initialTheme);

  return (
    <div style={{ display: "flex", gap: 10 }}>
      {(["light", "dark"] as const).map((t) => {
        const isActive = theme === t;
        return (
          <ThemeButton
            key={t}
            theme={t}
            onSet={setTheme}
            style={{
              flex: fullWidth ? 1 : undefined,
              width: fullWidth ? "100%" : undefined,
              padding: fullWidth ? "10px 18px" : "8px 18px",
              borderRadius: fullWidth ? 12 : 999,
              fontSize: 14,
              fontWeight: isActive ? 600 : 400,
              cursor: "pointer",
              border: isActive ? "2px solid var(--color-clay)" : "1px solid var(--color-border)",
              background: isActive ? "var(--color-clay-soft)" : "transparent",
              color: isActive ? "var(--color-clay-deep)" : "var(--color-ink-muted)",
              transition: "all 120ms ease",
            }}
          >
            {LABEL[t]}
          </ThemeButton>
        );
      })}
    </div>
  );
}
