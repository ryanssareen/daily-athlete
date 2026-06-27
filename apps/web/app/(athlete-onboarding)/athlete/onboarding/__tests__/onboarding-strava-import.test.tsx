// Renders the REAL <StravaImportScreen> (the onboarding Strava import step)
// to static HTML and asserts the user-visible contract for each state. The web
// vitest env is Node-only (no jsdom), so we use react-dom/server — useEffect
// (the 30s staleness timer) doesn't run under SSR, which is fine: the states
// we assert here don't depend on it.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BackfillStatusColumn } from "@da2/shared";

import { StravaImportScreen } from "../onboarding-flow";

function render(backfill: BackfillStatusColumn): string {
  return renderToStaticMarkup(
    createElement(StravaImportScreen, {
      email: "ryan@example.com",
      backfill,
      onRetry: () => {},
      onContinue: () => {},
    })
  );
}

describe("StravaImportScreen", () => {
  it("shows an advancing count while importing (not frozen at 0)", () => {
    const html = render({
      provider: "strava",
      state: "in_progress",
      completed: 66,
      estimated_total: 200,
    });
    expect(html).toContain("Pulling your recent workouts");
    expect(html).toContain(">66<"); // the live count
    expect(html).toContain("of 200");
    // mid-import the primary action is the (disabled) working state
    expect(html).toContain("Working…");
  });

  it("surfaces the REAL failure detail — not a generic template", () => {
    const detail =
      "Imported 66 workouts before the import time budget ran out. Tap Retry to pull the rest.";
    const html = render({
      provider: "strava",
      state: "failed",
      error_code: "timed_out",
      completed: 66,
      error_detail: detail,
    });
    // The actual error message the worker recorded is shown verbatim…
    expect(html).toContain(detail);
    // …and the user is never stranded on a dead disabled button.
    expect(html).toContain("Continue anyway");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Working…");
  });

  it("asks to reconnect (not just 'try again') when the token needs re-auth", () => {
    const html = render({
      provider: "strava",
      state: "needs_reauth",
      error_code: "needs_reauth",
    });
    expect(html).toContain("Reconnect Strava");
    expect(html).toContain("Continue anyway");
  });

  it("renders the done state with a real CTA once complete", () => {
    const html = render({
      provider: "strava",
      state: "complete",
      completed: 187,
      estimated_total: 187,
    });
    expect(html).toContain("Workouts imported");
    expect(html).toContain("See my profile");
    expect(html).not.toContain("Working…");
  });
});
