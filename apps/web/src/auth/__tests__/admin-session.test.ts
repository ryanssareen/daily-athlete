// Pure-unit tests for the admin session crypto + request helpers. No DB:
// these cover the load-bearing CSRF/auth primitives (constant-time compare,
// HMAC-bound token, fail-closed CSRF) the same way state-nonce.test.ts does
// for the Strava flow. DB-backed lifecycle/lockout lives in
// admin-session.db.test.ts.

import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ADMIN_PASSWORD = "correct-horse-battery-staple";
  process.env.ADMIN_SESSION_SIGNING_KEY =
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
});

import {
  clientIp,
  constantTimeEqual,
  isSameOriginRequest,
  parseSessionToken,
  signSessionToken,
  verifyAdminPassword,
} from "../admin-session";

const PASSWORD = "correct-horse-battery-staple";
const nowS = () => Math.floor(Date.now() / 1000);

describe("constantTimeEqual", () => {
  it("is true for equal strings", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
  });
  it("is false for equal-length but different strings", () => {
    expect(constantTimeEqual("abc", "abd")).toBe(false);
  });
  it("is false for different lengths", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
  it("is true for two empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("verifyAdminPassword", () => {
  it("accepts the correct password", () => {
    expect(verifyAdminPassword(PASSWORD)).toBe(true);
  });
  it("rejects a wrong password", () => {
    expect(verifyAdminPassword("nope")).toBe(false);
  });
  it("rejects an empty password", () => {
    expect(verifyAdminPassword("")).toBe(false);
  });
  it("rejects a near-miss (extra char)", () => {
    expect(verifyAdminPassword(`${PASSWORD}x`)).toBe(false);
  });
});

describe("session token sign/parse", () => {
  const SID = "a".repeat(64);

  it("round-trips a fresh token", () => {
    const exp = nowS() + 3600;
    const parsed = parseSessionToken(signSessionToken(SID, exp));
    expect(parsed).toEqual({ sessionId: SID, expiresAt: exp });
  });

  it("rejects a tampered HMAC (last char flipped)", () => {
    const tok = signSessionToken(SID, nowS() + 3600);
    const [a, b, h] = tok.split(".");
    const flipped = `${h!.slice(0, -1)}${h!.endsWith("0") ? "1" : "0"}`;
    expect(parseSessionToken(`${a}.${b}.${flipped}`)).toBeNull();
  });

  it("rejects a truncated (different-length) HMAC without leaking via early return", () => {
    const tok = signSessionToken(SID, nowS() + 3600);
    const [a, b, h] = tok.split(".");
    expect(parseSessionToken(`${a}.${b}.${h!.slice(0, 10)}`)).toBeNull();
  });

  it("rejects a token past its absolute expiry", () => {
    expect(parseSessionToken(signSessionToken(SID, nowS() - 10))).toBeNull();
  });

  it("rejects malformed shapes", () => {
    expect(parseSessionToken("")).toBeNull();
    expect(parseSessionToken("one.two")).toBeNull();
    expect(parseSessionToken("a.b.c.d")).toBeNull();
    expect(parseSessionToken(undefined)).toBeNull();
    expect(parseSessionToken(null)).toBeNull();
  });

  it("rejects a non-integer expiry", () => {
    expect(parseSessionToken(`${SID}.notanumber.deadbeef`)).toBeNull();
  });
});

describe("clientIp", () => {
  it("prefers x-vercel-forwarded-for", () => {
    const h = new Headers({
      "x-vercel-forwarded-for": "1.2.3.4",
      "x-real-ip": "8.8.8.8",
      "x-forwarded-for": "9.9.9.9",
    });
    expect(clientIp(h)).toBe("1.2.3.4");
  });
  it("falls back to x-real-ip", () => {
    expect(
      clientIp(new Headers({ "x-real-ip": "8.8.8.8", "x-forwarded-for": "9.9.9.9" }))
    ).toBe("8.8.8.8");
  });
  it("uses the leftmost x-forwarded-for entry", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "5.5.5.5, 6.6.6.6" }))).toBe(
      "5.5.5.5"
    );
  });
  it("returns 'unknown' when no IP header is present", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("isSameOriginRequest (CSRF, fail-closed)", () => {
  const sfs = (v: string) => new Headers({ "sec-fetch-site": v });
  it("allows same-origin", () => expect(isSameOriginRequest(sfs("same-origin"))).toBe(true));
  it("allows none (direct navigation)", () => expect(isSameOriginRequest(sfs("none"))).toBe(true));
  it("rejects cross-site", () => expect(isSameOriginRequest(sfs("cross-site"))).toBe(false));
  it("rejects same-site", () => expect(isSameOriginRequest(sfs("same-site"))).toBe(false));
  it("fails closed when the header is absent", () => {
    expect(isSameOriginRequest(new Headers())).toBe(false);
  });
});
