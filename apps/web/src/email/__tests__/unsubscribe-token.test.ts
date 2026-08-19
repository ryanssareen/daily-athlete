// Tests for unsubscribe capability tokens (U8, KTD7).
//
// This token is the ONLY authority behind a state change that happens with no
// session, so the tests are about bounding what it can do rather than proving
// that the happy path works. Every "rejects" case below is a way an attacker
// or a stale mailbox could otherwise reach an account.

import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

const mocks = vi.hoisted(() => ({ key: undefined as string | undefined }));

vi.mock("@/config", () => ({
  get config() {
    return { email: { unsubscribeSigningKey: mocks.key } };
  },
}));

const USER = "00000000-0000-0000-0000-0000000000a1";
const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);

async function mod() {
  return import("../unsubscribe-token");
}

beforeEach(() => {
  vi.resetModules();
  mocks.key = KEY_A;
});

describe("round trip", () => {
  it("recovers the user and cadence it was minted for", async () => {
    const { createUnsubscribeToken, verifyUnsubscribeToken } = await mod();
    const token = createUnsubscribeToken(USER, "weekly", NOW)!;
    expect(verifyUnsubscribeToken(token, NOW)).toEqual({
      ok: true,
      userId: USER,
      cadence: "weekly",
    });
  });

  it("round-trips the monthly cadence too", async () => {
    const { createUnsubscribeToken, verifyUnsubscribeToken } = await mod();
    const token = createUnsubscribeToken(USER, "monthly", NOW)!;
    const result = verifyUnsubscribeToken(token, NOW);
    expect(result.ok && result.cadence).toBe("monthly");
  });
});

describe("bounding the capability", () => {
  // A weekly link found in an inbox must not be usable to silence the monthly
  // digest as well. The cadence is inside the signed payload, so it cannot be
  // swapped without invalidating the signature.
  it("cannot be replayed against the other cadence", async () => {
    const { createUnsubscribeToken, verifyUnsubscribeToken } = await mod();
    const weekly = createUnsubscribeToken(USER, "weekly", NOW)!;
    const result = verifyUnsubscribeToken(weekly, NOW);
    expect(result.ok && result.cadence).toBe("weekly");
    expect(result.ok && result.cadence).not.toBe("monthly");
  });

  it("rejects a tampered payload", async () => {
    const { createUnsubscribeToken, verifyUnsubscribeToken } = await mod();
    const token = createUnsubscribeToken(USER, "weekly", NOW)!;
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ v: "v1", uid: "someone-else", cadence: "weekly", exp: 9999999999 }),
    ).toString("base64url");
    const result = verifyUnsubscribeToken(`${forged}.${sig}`, NOW);
    expect(result.ok).toBe(false);
    expect(payload).not.toBe(forged);
  });

  it("rejects a tampered signature", async () => {
    const { createUnsubscribeToken, verifyUnsubscribeToken } = await mod();
    const token = createUnsubscribeToken(USER, "weekly", NOW)!;
    const [payload] = token.split(".");
    expect(verifyUnsubscribeToken(`${payload}.deadbeef`, NOW).ok).toBe(false);
  });

  it("rejects a token signed with a different key", async () => {
    const { createUnsubscribeToken } = await mod();
    const token = createUnsubscribeToken(USER, "weekly", NOW)!;

    vi.resetModules();
    mocks.key = KEY_B;
    const { verifyUnsubscribeToken } = await mod();
    expect(verifyUnsubscribeToken(token, NOW).ok).toBe(false);
  });

  it("rejects an expired token", async () => {
    const { createUnsubscribeToken, verifyUnsubscribeToken, UNSUBSCRIBE_TOKEN_TTL_S } = await mod();
    const token = createUnsubscribeToken(USER, "weekly", NOW)!;
    const afterExpiry = NOW + (UNSUBSCRIBE_TOKEN_TTL_S + 1) * 1000;
    expect(verifyUnsubscribeToken(token, afterExpiry)).toEqual({ ok: false, reason: "expired" });
  });

  it("still accepts a token just before it expires", async () => {
    const { createUnsubscribeToken, verifyUnsubscribeToken, UNSUBSCRIBE_TOKEN_TTL_S } = await mod();
    const token = createUnsubscribeToken(USER, "weekly", NOW)!;
    expect(verifyUnsubscribeToken(token, NOW + (UNSUBSCRIBE_TOKEN_TTL_S - 1) * 1000).ok).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["no separator", "justonepart"],
    ["empty payload", ".sig"],
    ["empty signature", "payload."],
    ["not base64", "!!!.???"],
  ])("rejects a malformed token (%s)", async (_label, token) => {
    const { verifyUnsubscribeToken } = await mod();
    expect(verifyUnsubscribeToken(token, NOW).ok).toBe(false);
  });

  // A version bump must invalidate old tokens rather than have them
  // reinterpreted under new payload rules.
  it("rejects a token carrying an unknown version", async () => {
    const { verifyUnsubscribeToken } = await mod();
    const { createHmac } = await import("node:crypto");
    const payload = Buffer.from(
      JSON.stringify({ v: "v99", uid: USER, cadence: "weekly", exp: 9999999999 }),
    ).toString("base64url");
    const sig = createHmac("sha256", KEY_A).update(payload).digest("base64url");
    expect(verifyUnsubscribeToken(`${payload}.${sig}`, NOW).ok).toBe(false);
  });

  it("rejects a correctly-signed token naming an unknown cadence", async () => {
    const { verifyUnsubscribeToken } = await mod();
    const { createHmac } = await import("node:crypto");
    const payload = Buffer.from(
      JSON.stringify({ v: "v1", uid: USER, cadence: "daily", exp: 9999999999 }),
    ).toString("base64url");
    const sig = createHmac("sha256", KEY_A).update(payload).digest("base64url");
    expect(verifyUnsubscribeToken(`${payload}.${sig}`, NOW).ok).toBe(false);
  });
});

describe("unconfigured", () => {
  // Minting must fail loudly-but-safely so the email builder declines to send
  // rather than mailing a dead unsubscribe link, which is worse than no email.
  it("mints nothing without a signing key", async () => {
    mocks.key = undefined;
    const { createUnsubscribeToken } = await mod();
    expect(createUnsubscribeToken(USER, "weekly", NOW)).toBeNull();
  });

  it("verifies nothing without a signing key", async () => {
    mocks.key = undefined;
    const { verifyUnsubscribeToken } = await mod();
    expect(verifyUnsubscribeToken("anything.at.all", NOW)).toEqual({
      ok: false,
      reason: "unconfigured",
    });
  });
});

describe("preferenceColumnFor", () => {
  it("maps each cadence to its own column", async () => {
    const { preferenceColumnFor } = await mod();
    expect(preferenceColumnFor("weekly")).toBe("email_weekly_review");
    expect(preferenceColumnFor("monthly")).toBe("email_monthly_review");
  });
});
