import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { isS256Method, isValidCodeVerifier, verifyPkceS256 } from "../pkce";

function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("verifyPkceS256", () => {
  const verifier = "a".repeat(64); // valid length, unreserved chars

  it("accepts a matching verifier/challenge pair", () => {
    expect(verifyPkceS256(verifier, challengeFor(verifier))).toBe(true);
  });

  it("rejects a mismatched challenge", () => {
    expect(verifyPkceS256(verifier, challengeFor("different"))).toBe(false);
  });

  it("rejects empty inputs", () => {
    expect(verifyPkceS256("", challengeFor(verifier))).toBe(false);
    expect(verifyPkceS256(verifier, "")).toBe(false);
  });

  it("rejects a plain (non-hashed) challenge", () => {
    // A `plain` PKCE would send the verifier itself as the challenge.
    expect(verifyPkceS256(verifier, verifier)).toBe(false);
  });
});

describe("isS256Method", () => {
  it("accepts only S256", () => {
    expect(isS256Method("S256")).toBe(true);
    expect(isS256Method("plain")).toBe(false);
    expect(isS256Method(undefined)).toBe(false);
    expect(isS256Method(null)).toBe(false);
    expect(isS256Method("s256")).toBe(false);
  });
});

describe("isValidCodeVerifier", () => {
  it("enforces the RFC 7636 length + charset", () => {
    expect(isValidCodeVerifier("a".repeat(43))).toBe(true);
    expect(isValidCodeVerifier("a".repeat(128))).toBe(true);
    expect(isValidCodeVerifier("a".repeat(42))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
    expect(isValidCodeVerifier("has spaces and!!")).toBe(false);
  });
});
