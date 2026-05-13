// Tests for the token-crypto module (Strava token AES-256-GCM, versioned).
//
// The module reads STRAVA_TOKEN_KEYS once at import (module-scope cache),
// so each test isolates its environment by re-importing via vitest's
// resetModules + dynamic import. Without resetModules the first test's env
// state would leak into subsequent ones.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY_A_HEX =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"; // 32 bytes
const KEY_B_HEX =
  "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"; // 32 bytes
const KEY_C_HEX =
  "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe"; // 32 bytes

async function importFresh(env: Record<string, string | undefined>) {
  vi.resetModules();
  // Wipe any prior STRAVA_TOKEN_KEYS before applying the new env. Use
  // bracket-form delete because Next.js's ambient types mark NODE_ENV as
  // read-only on process.env.
  delete (process.env as Record<string, string | undefined>).STRAVA_TOKEN_KEYS;
  delete (process.env as Record<string, string | undefined>).NODE_ENV;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  return await import("../token-crypto");
}

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  // Restore env after each test so we don't bleed into other suites.
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe("token-crypto round-trip", () => {
  it("encrypts and decrypts plaintext with the current key version", async () => {
    const { encrypt, decrypt, currentKeyVersion } = await importFresh({
      STRAVA_TOKEN_KEYS: `1:${KEY_A_HEX}`,
    });

    const plaintext = new TextEncoder().encode("hello");
    const { ciphertext, keyVersion } = encrypt(plaintext);

    expect(keyVersion).toBe(1);
    expect(currentKeyVersion()).toBe(1);

    const recovered = decrypt(ciphertext, keyVersion);
    expect(new TextDecoder().decode(recovered)).toBe("hello");
  });

  it("uses the highest version when multiple keys are present", async () => {
    const { encrypt, decrypt, currentKeyVersion } = await importFresh({
      STRAVA_TOKEN_KEYS: `1:${KEY_A_HEX},2:${KEY_B_HEX}`,
    });

    expect(currentKeyVersion()).toBe(2);
    const { ciphertext, keyVersion } = encrypt(
      new TextEncoder().encode("rotate me")
    );
    expect(keyVersion).toBe(2);
    expect(new TextDecoder().decode(decrypt(ciphertext, 2))).toBe("rotate me");
  });

  it("retains older keys for decryption after rotation", async () => {
    // First boot: only version 1 exists. Encrypt with it.
    const v1 = await importFresh({ STRAVA_TOKEN_KEYS: `1:${KEY_A_HEX}` });
    const { ciphertext: oldCipher } = v1.encrypt(
      new TextEncoder().encode("legacy")
    );

    // Reboot with v1 + v2 configured. Old ciphertext must still decrypt.
    const v2 = await importFresh({
      STRAVA_TOKEN_KEYS: `1:${KEY_A_HEX},2:${KEY_B_HEX}`,
    });
    expect(v2.currentKeyVersion()).toBe(2);
    expect(new TextDecoder().decode(v2.decrypt(oldCipher, 1))).toBe("legacy");
  });

  it("uses a fresh IV per call (same plaintext encrypts to different ciphertext)", async () => {
    const { encrypt } = await importFresh({
      STRAVA_TOKEN_KEYS: `1:${KEY_A_HEX}`,
    });
    const plaintext = new TextEncoder().encode("same-input");
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(
      false
    );
  });

  it("round-trips empty plaintext", async () => {
    const { encrypt, decrypt } = await importFresh({
      STRAVA_TOKEN_KEYS: `1:${KEY_A_HEX}`,
    });
    const { ciphertext, keyVersion } = encrypt(new Uint8Array(0));
    const recovered = decrypt(ciphertext, keyVersion);
    expect(recovered.byteLength).toBe(0);
  });

  it("ciphertext layout is iv(12) || authTag(16) || encrypted(N)", async () => {
    const { encrypt } = await importFresh({
      STRAVA_TOKEN_KEYS: `1:${KEY_A_HEX}`,
    });
    const plaintext = new TextEncoder().encode("abc");
    const { ciphertext } = encrypt(plaintext);
    // iv(12) + tag(16) + 3 bytes plaintext = 31 bytes.
    expect(ciphertext.byteLength).toBe(12 + 16 + plaintext.byteLength);
  });
});

describe("token-crypto failure modes", () => {
  it("decrypt with a non-existent key version throws", async () => {
    const { encrypt, decrypt } = await importFresh({
      STRAVA_TOKEN_KEYS: `1:${KEY_A_HEX}`,
    });
    const { ciphertext } = encrypt(new TextEncoder().encode("x"));
    expect(() => decrypt(ciphertext, 99)).toThrow(/key.*version|unknown/i);
  });

  it("decrypt with wrong key (correct version slot, different bytes) throws on auth tag", async () => {
    // Encrypt with key A as version 1.
    const writer = await importFresh({ STRAVA_TOKEN_KEYS: `1:${KEY_A_HEX}` });
    const { ciphertext } = writer.encrypt(new TextEncoder().encode("secret"));

    // Reload module with version 1 mapped to key B (operator misconfigured).
    const reader = await importFresh({ STRAVA_TOKEN_KEYS: `1:${KEY_B_HEX}` });
    expect(() => reader.decrypt(ciphertext, 1)).toThrow();
  });

  it("tampered auth tag fails decrypt", async () => {
    const { encrypt, decrypt } = await importFresh({
      STRAVA_TOKEN_KEYS: `1:${KEY_A_HEX}`,
    });
    const { ciphertext, keyVersion } = encrypt(
      new TextEncoder().encode("integrity")
    );
    // Flip a bit inside the auth-tag region (bytes 12-27).
    const tampered = new Uint8Array(ciphertext);
    tampered[20] ^= 0x01;
    expect(() => decrypt(tampered, keyVersion)).toThrow();
  });

  it("STRAVA_TOKEN_KEYS missing -> first use throws clearly", async () => {
    const mod = await importFresh({ STRAVA_TOKEN_KEYS: undefined });
    expect(() => mod.currentKeyVersion()).toThrow(/STRAVA_TOKEN_KEYS/);
    expect(() => mod.encrypt(new Uint8Array([1]))).toThrow(/STRAVA_TOKEN_KEYS/);
  });

  it("STRAVA_TOKEN_KEYS empty string -> throws", async () => {
    const mod = await importFresh({ STRAVA_TOKEN_KEYS: "" });
    expect(() => mod.currentKeyVersion()).toThrow(/STRAVA_TOKEN_KEYS/);
  });

  it("placeholder values (NODE_ENV=production) -> throws", async () => {
    const mod = await importFresh({
      STRAVA_TOKEN_KEYS: "1:hex",
      NODE_ENV: "production",
    });
    expect(() => mod.currentKeyVersion()).toThrow(/placeholder|hex/i);
  });

  it("all-zero key (NODE_ENV=production) -> throws", async () => {
    const zero = "0".repeat(64);
    const mod = await importFresh({
      STRAVA_TOKEN_KEYS: `1:${zero}`,
      NODE_ENV: "production",
    });
    expect(() => mod.currentKeyVersion()).toThrow(/placeholder|zero/i);
  });

  it("key of wrong length (not 32 bytes) -> throws", async () => {
    const tooShort = "abcd";
    const mod = await importFresh({
      STRAVA_TOKEN_KEYS: `1:${tooShort}`,
    });
    expect(() => mod.currentKeyVersion()).toThrow(/32 bytes|256 bits|length/i);
  });

  it("malformed entry (missing version prefix) -> throws", async () => {
    const mod = await importFresh({
      STRAVA_TOKEN_KEYS: KEY_A_HEX, // no `v:` prefix
    });
    expect(() => mod.currentKeyVersion()).toThrow();
  });

  it("non-integer version -> throws", async () => {
    const mod = await importFresh({
      STRAVA_TOKEN_KEYS: `a:${KEY_A_HEX}`,
    });
    expect(() => mod.currentKeyVersion()).toThrow();
  });

  it("duplicate version numbers -> throws", async () => {
    const mod = await importFresh({
      STRAVA_TOKEN_KEYS: `1:${KEY_A_HEX},1:${KEY_B_HEX}`,
    });
    expect(() => mod.currentKeyVersion()).toThrow(/duplicate|version/i);
  });

  it("placeholder gate is production-only (dev surfaces a different error)", async () => {
    // Outside production we don't special-case the literal placeholder
    // strings -- but malformed hex still fails downstream validation, so the
    // app still won't boot with junk keys. The point is: the placeholder
    // error message only fires in production.
    const mod = await importFresh({
      STRAVA_TOKEN_KEYS: "1:hex",
      NODE_ENV: "development",
    });
    expect(() => mod.currentKeyVersion()).toThrow();
    expect(() => mod.currentKeyVersion()).not.toThrow(/placeholder/i);
  });

  it("all-zero key allowed outside production (boots; production-only gate)", async () => {
    // Mirror the prod-gating posture: all-zero is a placeholder signal we
    // only enforce in NODE_ENV=production. In dev, it parses (the bytes are
    // 32 long), and the validator does not throw. Real callers would fail
    // their actual encrypt calls on this key, but boot succeeds.
    const zero = "0".repeat(64);
    const mod = await importFresh({
      STRAVA_TOKEN_KEYS: `1:${zero}`,
      NODE_ENV: "development",
    });
    expect(mod.currentKeyVersion()).toBe(1);
  });
});

describe("token-crypto types", () => {
  it("accepts Uint8Array input and returns Uint8Array output", async () => {
    const { encrypt, decrypt } = await importFresh({
      STRAVA_TOKEN_KEYS: `1:${KEY_C_HEX}`,
    });
    const input = new Uint8Array([1, 2, 3, 4, 5]);
    const { ciphertext } = encrypt(input);
    expect(ciphertext).toBeInstanceOf(Uint8Array);
    const out = decrypt(ciphertext, 1);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });
});
