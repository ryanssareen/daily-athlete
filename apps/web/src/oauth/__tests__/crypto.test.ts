import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { generateOpaqueToken, hashToken, mintSupabaseJwt } from "../crypto";

describe("generateOpaqueToken", () => {
  it("returns a 256-bit url-safe token", () => {
    const t = generateOpaqueToken();
    // 32 bytes -> 43 base64url chars (no padding)
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is unique across calls", () => {
    const set = new Set(Array.from({ length: 100 }, () => generateOpaqueToken()));
    expect(set.size).toBe(100);
  });
});

describe("hashToken", () => {
  it("is a deterministic 64-hex-char SHA-256", () => {
    const h = hashToken("abc");
    expect(h).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("differs for different inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("mintSupabaseJwt", () => {
  const secret = "test-jwt-secret-at-least-32-characters-long";
  const supabaseUrl = "https://proj.supabase.co";

  function parts(jwt: string) {
    const [h, p, s] = jwt.split(".");
    return {
      header: JSON.parse(Buffer.from(h, "base64url").toString("utf8")),
      payload: JSON.parse(Buffer.from(p, "base64url").toString("utf8")),
      signingInput: `${h}.${p}`,
      sig: s,
    };
  }

  it("emits a verifiable HS256 JWT with the Supabase claim set", () => {
    const jwt = mintSupabaseJwt({
      userId: "user-123",
      secret,
      supabaseUrl,
      ttlSeconds: 60,
      nowSeconds: 1_000,
    });
    const { header, payload, signingInput, sig } = parts(jwt);

    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(payload.sub).toBe("user-123");
    expect(payload.role).toBe("authenticated");
    expect(payload.aud).toBe("authenticated");
    expect(payload.iss).toBe("https://proj.supabase.co/auth/v1");
    expect(payload.iat).toBe(1_000);
    expect(payload.exp).toBe(1_060);

    const expected = createHmac("sha256", secret)
      .update(signingInput)
      .digest("base64url");
    expect(sig).toBe(expected);
  });

  it("does not validate under a different secret", () => {
    const jwt = mintSupabaseJwt({ userId: "u", secret, supabaseUrl });
    const { signingInput, sig } = parts(jwt);
    const wrong = createHmac("sha256", "another-secret")
      .update(signingInput)
      .digest("base64url");
    expect(sig).not.toBe(wrong);
  });

  it("strips a trailing slash from the supabase url when building iss", () => {
    const jwt = mintSupabaseJwt({
      userId: "u",
      secret,
      supabaseUrl: "https://proj.supabase.co/",
    });
    expect(parts(jwt).payload.iss).toBe("https://proj.supabase.co/auth/v1");
  });
});
