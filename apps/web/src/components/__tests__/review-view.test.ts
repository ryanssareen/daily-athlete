// Tests for the period-review view logic (U7).
//
// The web vitest env is Node-only -- no jsdom / testing-library is installed
// and adding one is out of scope here -- so, matching the rest of the suite
// (see app-shell-responsive.test.ts), these assert the CONTRACT rather than
// render the tree. Every decision worth asserting was extracted into
// review-view.ts precisely so it could be tested this way.

import { describe, expect, it } from "vitest";

import {
  formatDelta,
  formatDistance,
  formatDuration,
  generateButtonLabel,
  interpretGenerateResponse,
  loadHint,
  periodLabel,
} from "../period-review/review-view";

// ---------------------------------------------------------------------------
// Never draw "unknown" as a number the athlete could act on
// ---------------------------------------------------------------------------

describe("formatDistance", () => {
  // "You covered no ground" and "nobody measured" are different claims. A
  // swimmer whose pool sessions carry no distance must not read 0.0 km.
  it("renders unknown distance as an em dash, never 0.0 km", () => {
    expect(formatDistance(null)).toBe("—");
  });

  it("renders a genuine zero as a zero", () => {
    expect(formatDistance(0)).toBe("0.0 km");
  });

  it("converts metres to kilometres", () => {
    expect(formatDistance(21097)).toBe("21.1 km");
  });

  it("does not emit NaN for a non-finite value", () => {
    expect(formatDistance(Number.NaN)).toBe("—");
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0m"],
    [-1, "0m"],
    [1800, "30m"],
    [3600, "1h 0m"],
    [22800, "6h 20m"],
  ])("formats %i seconds as %s", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

describe("formatDelta", () => {
  it.each([
    [25, "+25%"],
    [-10, "-10%"],
    [0, "0%"],
    [9.5, "+10%"],
  ])("formats %d as %s", (input, expected) => {
    expect(formatDelta(input)).toBe(expected);
  });
});

describe("loadHint", () => {
  // Silence is the claim "this is measured", so it must only appear when true.
  it("is silent when every session had real intensity data", () => {
    expect(loadHint("power")).toBeUndefined();
  });

  it.each([
    ["duration", "partly estimated"],
    ["mixed", "partly estimated"],
    ["none", "no load data"],
  ])("flags %s load as %s", (confidence, expected) => {
    expect(loadHint(confidence)).toBe(expected);
  });
});

describe("periodLabel", () => {
  it("labels a week by its starting day", () => {
    expect(periodLabel("weekly", { start: "2026-08-10" })).toBe("Week of 10 Aug 2026");
  });

  it("labels a month by name and year", () => {
    expect(periodLabel("monthly", { start: "2026-08-01" })).toBe("August 2026");
  });

  // Rendered in UTC deliberately: the bounds are already resolved local dates,
  // so re-interpreting them in the browser's zone would shift the label by a
  // day for anyone west of UTC.
  it("does not shift the label by the runtime's timezone", () => {
    expect(periodLabel("monthly", { start: "2026-01-01" })).toBe("January 2026");
  });
});

// ---------------------------------------------------------------------------
// The 200-with-no-prose trap (AE9)
// ---------------------------------------------------------------------------

describe("interpretGenerateResponse", () => {
  const NARRATION = { note: "Solid week.", takeaway: "Hold the volume." };

  it("treats a response carrying prose as generated", () => {
    expect(interpretGenerateResponse(200, { narration: NARRATION, stale: false })).toEqual({
      phase: "generated",
      narration: NARRATION,
      stale: false,
    });
  });

  it("carries staleness through a successful generation", () => {
    const out = interpretGenerateResponse(200, { narration: NARRATION, stale: true });
    expect(out.phase === "generated" && out.stale).toBe(true);
  });

  // THE TRAP: the route returns 200 with facts intact when narration failed.
  // A client branching on res.ok would show success for a response with no
  // prose in it at all.
  it("treats a 200 with no narration as a failure, not a success", () => {
    const out = interpretGenerateResponse(200, { narration: null, retryable: true });
    expect(out.phase).not.toBe("generated");
  });

  it("distinguishes a retryable backoff from a permanent failure", () => {
    expect(interpretGenerateResponse(200, { narration: null, retryable: true }).phase).toBe(
      "retryable",
    );
    expect(interpretGenerateResponse(200, { narration: null, retryable: false }).phase).toBe(
      "failed",
    );
  });

  // Absent `retryable` means no generation attempt reported one; promising a
  // retry there would invite the athlete to hammer a button that cannot work.
  it("does not promise a retry when the response says nothing about one", () => {
    expect(interpretGenerateResponse(200, { narration: null }).phase).toBe("failed");
  });

  it("surfaces a quota refusal distinctly from a model failure", () => {
    expect(interpretGenerateResponse(429, null).phase).toBe("rate_limited");
  });

  it.each([401, 402, 404, 500])("treats %i as an error", (status) => {
    expect(interpretGenerateResponse(status, null).phase).toBe("error");
  });

  it("treats an unparseable body as an error rather than a success", () => {
    expect(interpretGenerateResponse(200, null).phase).toBe("error");
  });
});

describe("generateButtonLabel", () => {
  it.each([
    [{ busy: true, hasNarration: false, stale: false }, "Writing…"],
    [{ busy: false, hasNarration: false, stale: false }, "Generate note"],
    [{ busy: false, hasNarration: true, stale: false }, "Rewrite note"],
    [{ busy: false, hasNarration: true, stale: true }, "Regenerate note"],
  ])("labels %o as %s", (opts, expected) => {
    expect(generateButtonLabel(opts)).toBe(expected);
  });

  it("shows the in-flight label even when a note is already on screen", () => {
    expect(generateButtonLabel({ busy: true, hasNarration: true, stale: true })).toBe("Writing…");
  });
});
