import { describe, expect, it } from "vitest";

import { signState, verifyState } from "../state";

// 32-byte key as 64 hex chars.
const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

describe("signState / verifyState", () => {
  it("round-trips the payload and strips iat", () => {
    const now = 1_000_000;
    const token = signState(
      { clientId: "c1", redirectUri: "https://x/cb", codeChallenge: "cc" },
      KEY,
      now
    );
    const out = verifyState(token, KEY, 600_000, now + 5_000);
    expect(out).toEqual({
      clientId: "c1",
      redirectUri: "https://x/cb",
      codeChallenge: "cc",
    });
  });

  it("rejects a tampered payload", () => {
    const now = 1_000_000;
    const token = signState({ clientId: "c1" }, KEY, now);
    const [, sig] = token.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ clientId: "evil", iat: now })
    ).toString("base64url");
    expect(verifyState(`${forgedBody}.${sig}`, KEY, 600_000, now)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const now = 1_000_000;
    const token = signState({ clientId: "c1" }, KEY, now);
    const [body] = token.split(".");
    expect(verifyState(`${body}.AAAA`, KEY, 600_000, now)).toBeNull();
  });

  it("rejects verification under a different key", () => {
    const now = 1_000_000;
    const token = signState({ clientId: "c1" }, KEY, now);
    expect(verifyState(token, OTHER_KEY, 600_000, now)).toBeNull();
  });

  it("rejects an expired token", () => {
    const now = 1_000_000;
    const token = signState({ clientId: "c1" }, KEY, now);
    expect(verifyState(token, KEY, 600_000, now + 600_001)).toBeNull();
  });

  it("rejects an implausibly future-dated token", () => {
    const now = 1_000_000;
    const token = signState({ clientId: "c1" }, KEY, now + 120_000);
    expect(verifyState(token, KEY, 600_000, now)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyState("", KEY)).toBeNull();
    expect(verifyState("nodot", KEY)).toBeNull();
    expect(verifyState(".sigonly", KEY)).toBeNull();
    expect(verifyState("bodyonly.", KEY)).toBeNull();
  });
});
