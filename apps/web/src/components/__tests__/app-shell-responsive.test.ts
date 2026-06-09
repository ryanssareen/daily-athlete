// Regression guard for the responsive app shell (athlete + coach).
//
// The original shell hard-coded a 220px sidebar in a flex row with no
// breakpoint, so every authenticated page was unusable on phones (the sidebar
// ate ~60% of a 375px screen). The fix lives in CSS (globals.css `.app-*`) plus
// src/components/app-shell.tsx. The web vitest env is Node-only — no jsdom /
// testing-library is installed and `pnpm install` is unavailable — so, matching
// the rest of the suite, we assert the *contract* rather than render the tree:
// the desktop sidebar is preserved AND a mobile breakpoint collapses it into a
// top bar. If someone deletes the breakpoint, this fails instead of silently
// shipping the broken layout again.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

/** Collapse whitespace so brittle formatting differences don't matter. */
function squash(s: string): string {
  return s.replace(/\s+/g, " ");
}

/** Body of the first `@media (max-width: <bp>px)` block, whitespace-squashed. */
function mediaBlock(maxWidthPx: number): string {
  const marker = `@media (max-width: ${maxWidthPx}px)`;
  const start = css.indexOf(marker);
  if (start === -1) return "";
  // Walk braces from the block's opening `{` to its matching close.
  const open = css.indexOf("{", start + marker.length);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      return squash(css.slice(open + 1, i));
    }
  }
  return "";
}

describe("app shell responsive contract", () => {
  const base = squash(css);

  it("preserves the 220px desktop sidebar", () => {
    expect(base).toMatch(/\.app-sidebar\s*\{[^}]*width:\s*220px/);
  });

  it("keeps mobile chrome hidden by default (desktop-first)", () => {
    expect(base).toMatch(/\.app-topbar\s*\{\s*display:\s*none/);
    expect(base).toMatch(/\.app-drawer\s*\{\s*display:\s*none/);
  });

  it("collapses the sidebar into a top bar at the mobile breakpoint", () => {
    const mobile = mediaBlock(768);
    expect(mobile).not.toBe("");
    expect(mobile).toMatch(/\.app-sidebar\s*\{\s*display:\s*none/);
    expect(mobile).toMatch(/\.app-topbar\s*\{[^}]*display:\s*flex/);
    // The drawer must become reachable so theme toggle + sign out aren't lost.
    expect(mobile).toMatch(/\.app-drawer\s*\{[^}]*display:\s*block/);
  });
});
