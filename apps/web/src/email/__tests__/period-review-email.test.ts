// Tests for the period-review digest email (U9).
//
// The email is the one surface where a wrong number cannot be clicked past, so
// the assertions here are mostly about honesty (unknown is not zero, an
// estimate says so, a first period is not a decline) and about the untrusted
// strings that reach an HTML body.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PeriodFactSheet } from "@/ai/period-reviews/fact-sheet";

const mocks = vi.hoisted(() => ({
  appBaseUrl: "https://app.example.com" as string | undefined,
  signingKey: "a".repeat(64) as string | undefined,
  sends: [] as Array<Record<string, unknown>>,
  sendResult: { sent: true } as { sent: boolean; reason?: string },
}));

vi.mock("@/config", () => ({
  get config() {
    return {
      email: {
        appBaseUrl: mocks.appBaseUrl,
        unsubscribeSigningKey: mocks.signingKey,
        brevoApiKey: "xkeysib-stub",
        sender: "hi@example.com",
      },
    };
  },
}));

vi.mock("../brevo", () => ({
  sendTransactionalEmail: vi.fn(async (params: Record<string, unknown>) => {
    mocks.sends.push(params);
    return mocks.sendResult;
  }),
}));

const ATHLETE = "00000000-0000-0000-0000-0000000000a1";

const SHEET: PeriodFactSheet = {
  kind: "weekly",
  periodKey: "2026-W33",
  bounds: { start: "2026-08-10", end: "2026-08-16" },
  totals: {
    sessions: 5,
    durationS: 22800,
    distanceM: 61000,
    load: 340,
    activeDays: 4,
    loadConfidence: "power",
  },
  compliance: { prescribed: 6, completed: 5, unplanned: 0 },
  duration: { status: "under", prescribed: 25200, actual: 22800, deltaPct: -9.5 },
  load: { status: "under", prescribed: 380, actual: 340, deltaPct: -10.5 },
  sports: [],
  comparison: {
    available: true,
    previousKey: "2026-W32",
    sessionsDeltaPct: 25,
    durationDeltaPct: 10,
    loadDeltaPct: 12,
    activeDaysDelta: 1,
  },
  standouts: [],
  goal: "marathon in October",
  eventDate: "2026-10-04",
};

const NARRATION = { note: "You held five of six together.", takeaway: "Keep it conversational." };

async function mod() {
  return import("../period-review-email");
}

function sheetWith(over: Partial<PeriodFactSheet>): PeriodFactSheet {
  return { ...SHEET, ...over };
}

beforeEach(() => {
  vi.resetModules();
  mocks.appBaseUrl = "https://app.example.com";
  mocks.signingKey = "a".repeat(64);
  mocks.sends = [];
  mocks.sendResult = { sent: true };
});

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

describe("buildDigestLinks", () => {
  it("deep links to the period's own review", async () => {
    const { buildDigestLinks } = await mod();
    const links = buildDigestLinks(ATHLETE, "weekly", "2026-W33")!;
    expect(links.reviewUrl).toBe("https://app.example.com/athlete/reports/weekly/2026-W33");
  });

  it("tolerates a trailing slash on the base URL", async () => {
    mocks.appBaseUrl = "https://app.example.com/";
    const { buildDigestLinks } = await mod();
    expect(buildDigestLinks(ATHLETE, "weekly", "2026-W33")!.reviewUrl).toBe(
      "https://app.example.com/athlete/reports/weekly/2026-W33",
    );
  });

  it("carries a token on both unsubscribe links", async () => {
    const { buildDigestLinks } = await mod();
    const links = buildDigestLinks(ATHLETE, "weekly", "2026-W33")!;
    expect(links.unsubscribePageUrl).toContain("token=");
    expect(links.unsubscribePostUrl).toContain("token=");
  });

  it("mints a token for the cadence being sent", async () => {
    const { buildDigestLinks } = await mod();
    const { verifyUnsubscribeToken } = await import("../unsubscribe-token");
    const links = buildDigestLinks(ATHLETE, "monthly", "2026-08")!;
    const token = decodeURIComponent(new URL(links.unsubscribePostUrl).searchParams.get("token")!);
    const verified = verifyUnsubscribeToken(token);
    expect(verified.ok && verified.cadence).toBe("monthly");
    expect(verified.ok && verified.userId).toBe(ATHLETE);
  });

  // Declining is the correct behaviour: a dead deep link wastes the athlete's
  // click, and an unhonourable unsubscribe is a trust and deliverability
  // problem.
  it("returns null without a base URL", async () => {
    mocks.appBaseUrl = undefined;
    const { buildDigestLinks } = await mod();
    expect(buildDigestLinks(ATHLETE, "weekly", "2026-W33")).toBeNull();
  });

  it("returns null without a signing key", async () => {
    mocks.signingKey = undefined;
    const { buildDigestLinks } = await mod();
    expect(buildDigestLinks(ATHLETE, "weekly", "2026-W33")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Subject and body
// ---------------------------------------------------------------------------

describe("subject", () => {
  it("names the cadence and the headline numbers", async () => {
    const { buildDigestSubject } = await mod();
    expect(buildDigestSubject(SHEET)).toBe("Your week in training — 5 sessions, 6h 20m");
  });

  it("says a month when the period is a month", async () => {
    const { buildDigestSubject } = await mod();
    expect(buildDigestSubject(sheetWith({ kind: "monthly" }))).toContain("Your month");
  });

  it("does not claim sessions for an empty period", async () => {
    const { buildDigestSubject } = await mod();
    const subject = buildDigestSubject(
      sheetWith({
        totals: { ...SHEET.totals, sessions: 0, durationS: 0, load: 0, loadConfidence: "none" },
      }),
    );
    expect(subject).toContain("quiet one");
    expect(subject).not.toContain("0 sessions");
  });

  it("uses the singular for one session", async () => {
    const { buildDigestSubject } = await mod();
    expect(buildDigestSubject(sheetWith({ totals: { ...SHEET.totals, sessions: 1 } }))).toContain(
      "1 session,",
    );
  });
});

describe("body", () => {
  async function build(sheet: PeriodFactSheet = SHEET) {
    const { buildPeriodDigestEmail, buildDigestLinks } = await mod();
    return buildPeriodDigestEmail({
      sheet,
      narration: NARRATION,
      links: buildDigestLinks(ATHLETE, sheet.kind, sheet.periodKey)!,
    }).html;
  }

  it("carries the headline totals", async () => {
    const html = await build();
    expect(html).toContain("6h 20m");
    expect(html).toContain("61.0 km");
    expect(html).toContain("340");
  });

  it("carries the compliance figure", async () => {
    expect(await build()).toContain("5 of 6");
  });

  it("carries the narration and the takeaway", async () => {
    const html = await build();
    expect(html).toContain(NARRATION.note);
    expect(html).toContain(NARRATION.takeaway);
  });

  it("links to the full review", async () => {
    expect(await build()).toContain("https://app.example.com/athlete/reports/weekly/2026-W33");
  });

  it("carries a visible unsubscribe link", async () => {
    const html = await build();
    expect(html).toContain("/unsubscribe?token=");
    expect(html).toContain("Unsubscribe");
  });

  // An email is a worse place to lie about a number than a screen, because the
  // athlete cannot click through to the caveat.
  it("renders unknown distance as an em dash, never 0.0 km", async () => {
    const html = await build(sheetWith({ totals: { ...SHEET.totals, distanceM: null } }));
    expect(html).toContain("—");
    expect(html).not.toContain("0.0 km");
  });

  it("flags an estimated load rather than presenting it as measured", async () => {
    const html = await build(sheetWith({ totals: { ...SHEET.totals, loadConfidence: "mixed" } }));
    expect(html).toContain("partly estimated");
  });

  it("stays silent about provenance when the load is measured", async () => {
    expect(await build()).not.toContain("partly estimated");
  });

  // A first-ever period must not read as a 100% decline.
  it("says there is nothing to compare when there is no prior period", async () => {
    const html = await build(sheetWith({ comparison: null }));
    expect(html).toContain("nothing to compare");
    expect(html).not.toContain("-100%");
  });

  it("renders the deltas when a prior period exists", async () => {
    const html = await build();
    expect(html).toContain("+25%");
    expect(html).toContain("+12%");
  });

  it("renders a coherent email for an empty period", async () => {
    const html = await build(
      sheetWith({
        totals: {
          sessions: 0,
          durationS: 0,
          distanceM: null,
          load: 0,
          activeDays: 0,
          loadConfidence: "none",
        },
        compliance: { prescribed: 4, completed: 0, unplanned: 0 },
      }),
    );
    expect(html).toContain("0 of 4");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });
});

// ---------------------------------------------------------------------------
// The untrusted-string boundary
// ---------------------------------------------------------------------------

describe("escaping", () => {
  async function buildWith(narration: { note: string; takeaway: string }) {
    const { buildPeriodDigestEmail, buildDigestLinks } = await mod();
    return buildPeriodDigestEmail({
      sheet: SHEET,
      narration,
      links: buildDigestLinks(ATHLETE, "weekly", "2026-W33")!,
    }).html;
  }

  // The narration is LLM output reaching an HTML body.
  it("escapes markup in the narration", async () => {
    const html = await buildWith({
      note: '<script>alert("x")</script>',
      takeaway: "ok",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes markup in the takeaway", async () => {
    const html = await buildWith({ note: "ok", takeaway: '<img src=x onerror="alert(1)">' });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("escapes quotes so a value cannot break out of an attribute", async () => {
    const html = await buildWith({ note: '" onmouseover="evil()', takeaway: "ok" });
    expect(html).not.toContain('" onmouseover="evil()');
    expect(html).toContain("&quot;");
  });
});

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

describe("sendPeriodDigest", () => {
  it("sends with the one-click unsubscribe header", async () => {
    const { sendPeriodDigest } = await mod();
    const result = await sendPeriodDigest({
      to: "athlete@example.com",
      athleteId: ATHLETE,
      sheet: SHEET,
      narration: NARRATION,
    });
    expect(result.sent).toBe(true);
    expect(mocks.sends).toHaveLength(1);
    expect(String(mocks.sends[0].unsubscribeUrl)).toContain("/api/unsubscribe?token=");
  });

  // Not a degradation -- declining is the correct behaviour.
  it("declines to send when the links cannot be built", async () => {
    mocks.appBaseUrl = undefined;
    const { sendPeriodDigest } = await mod();
    const result = await sendPeriodDigest({
      to: "athlete@example.com",
      athleteId: ATHLETE,
      sheet: SHEET,
      narration: NARRATION,
    });
    expect(result).toEqual({ sent: false, reason: "not_configured" });
    expect(mocks.sends).toEqual([]);
  });

  it("passes a provider failure through rather than throwing", async () => {
    mocks.sendResult = { sent: false, reason: "http_429" };
    const { sendPeriodDigest } = await mod();
    const result = await sendPeriodDigest({
      to: "athlete@example.com",
      athleteId: ATHLETE,
      sheet: SHEET,
      narration: NARRATION,
    });
    expect(result).toEqual({ sent: false, reason: "http_429" });
  });
});
