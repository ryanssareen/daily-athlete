"use client";

// A theme-switch control that applies instantly, client-side, with zero page
// navigation — no visible reload for what is just a CSS variable flip.
//
// Previously every call site rendered <form action="/api/theme" method="post">,
// so clicking it triggered a real browser POST + redirect + full page reload.
// That's real work (and a visible flash) for a background-color change. This
// button instead flips document.documentElement.dataset.theme synchronously
// (globals.css keys every themed CSS variable off [data-theme="dark"] on
// <html>, per app/layout.tsx) and persists the choice by setting the
// da2-theme cookie directly — no round trip to the server is needed for
// either the visual update or the persistence.
//
// /api/theme itself is left in place as a plain, working POST endpoint (not
// referenced by any client code anymore) rather than deleted, in case a
// no-JS fallback is wanted later; nothing currently depends on it.

import type { CSSProperties, MouseEvent, ReactNode } from "react";

const THEME_COOKIE = "da2-theme";
const ONE_YEAR_S = 31536000;

function applyTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${ONE_YEAR_S}; samesite=lax`;
}

export function ThemeButton({
  theme,
  onSet,
  style,
  className,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  /** The theme this button switches TO when clicked. */
  theme: "light" | "dark";
  /** Called after the theme is applied, so the caller can update its own
   *  "which theme is active" display state. */
  onSet?: (theme: "light" | "dark") => void;
  style?: CSSProperties;
  className?: string;
  onMouseEnter?: (e: MouseEvent<HTMLButtonElement>) => void;
  onMouseLeave?: (e: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={() => {
        applyTheme(theme);
        onSet?.(theme);
      }}
    >
      {children}
    </button>
  );
}
