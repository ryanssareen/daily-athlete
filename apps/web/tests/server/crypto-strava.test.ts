/**
 * Tests for Strava token encryption.
 *
 * No network, no DB, no Supabase. Each test mutates process.env to set
 * STRAVA_TOKEN_KEYS, resets the config + crypto caches, and exercises the
 * real Web Crypto AES-256-GCM path.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetConfigCache } from "@/server/config";
import {
  TokenCryptoError,
  _internalsForTests,
  decryptStravaToken,
  encryptStravaToken,
  resetKeyCache,
} from "@/server/crypto/strava";

// Two distinct 64-hex-char keys (32 bytes each).
const KEY_V1 = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const KEY_V2 = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";
const KEY_V3 = "0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9";

// Minimal env that satisfies the production validator (Unit-1 config.ts).
function setEnv(overrides: Record<string, string | undefined>) {
  process.env.APP_ENV = "test";
  process.env.SUPABASE_URL = "https://test.example";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_JWT_ISSUER = "https://test.example/auth/v1";
  process.env.SUPABASE_JWT_JWKS_URL = "https://test.example/auth/v1/.well-known/jwks.json";
  process.env.STRAVA_TOKEN_KEYS = "";
  process.env.STRAVA_TOKEN_KEY = "";
  process.env.CRON_SECRET = "x".repeat(40);
  process.env.TRUSTED_HOSTS = "test.example";
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigCache();
  resetKeyCache();
}

let envSnapshot: typeof process.env;
beforeEach(() => {
  envSnapshot = { ...process.env };
});
afterEach(() => {
  process.env = envSnapshot;
  resetConfigCache();
  resetKeyCache();
});

describe("encrypt + decrypt round-trip", () => {
  it("produces a different envelope each time (random IV)", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1}` });
    const a = await encryptStravaToken("strava-access-token-12345");
    const b = await encryptStravaToken("strava-access-token-12345");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.keyVersion).toBe(1);
    expect(b.keyVersion).toBe(1);
  });

  it("decrypts what it encrypted", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1}` });
    const plaintext = "abc.def.ghi-strava-token";
    const { ciphertext } = await encryptStravaToken(plaintext);
    const recovered = await decryptStravaToken(ciphertext);
    expect(recovered).toBe(plaintext);
  });

  it("preserves unicode plaintext", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1}` });
    const plaintext = "tøken-with-unïcode-✓";
    const { ciphertext } = await encryptStravaToken(plaintext);
    expect(await decryptStravaToken(ciphertext)).toBe(plaintext);
  });

  it("envelope has 5 colon-separated segments starting with format_version=1", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1}` });
    const { ciphertext } = await encryptStravaToken("hello");
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("1");
    expect(parts[1]).toBe("1");
  });
});

describe("multi-key rotation", () => {
  it("encryption uses the highest configured key version", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1},2:${KEY_V2}` });
    const { keyVersion } = await encryptStravaToken("hello");
    expect(keyVersion).toBe(2);
  });

  it("decrypts ciphertext stamped under v1 even after v2 is added", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1}` });
    const v1Result = await encryptStravaToken("plain-1");
    expect(v1Result.keyVersion).toBe(1);

    // Operator rotates by adding v2 — v1 must still decrypt.
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1},2:${KEY_V2}` });
    expect(await decryptStravaToken(v1Result.ciphertext)).toBe("plain-1");

    const v2Result = await encryptStravaToken("plain-2");
    expect(v2Result.keyVersion).toBe(2);
    expect(await decryptStravaToken(v2Result.ciphertext)).toBe("plain-2");
  });

  it("supports gappy version numbers (e.g. 1 + 3)", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1},3:${KEY_V3}` });
    const { keyVersion } = await encryptStravaToken("hello");
    expect(keyVersion).toBe(3);
    expect(_internalsForTests().versions).toEqual([1, 3]);
  });
});

describe("legacy single-key fallback", () => {
  it("uses STRAVA_TOKEN_KEY as version 1 when STRAVA_TOKEN_KEYS is empty", async () => {
    setEnv({ STRAVA_TOKEN_KEY: KEY_V1 });
    const { keyVersion, ciphertext } = await encryptStravaToken("legacy-plain");
    expect(keyVersion).toBe(1);
    expect(await decryptStravaToken(ciphertext)).toBe("legacy-plain");
  });

  it("STRAVA_TOKEN_KEYS takes precedence over the legacy single-key when both are set", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `2:${KEY_V2}`, STRAVA_TOKEN_KEY: KEY_V1 });
    const { keyVersion } = await encryptStravaToken("hello");
    expect(keyVersion).toBe(2);
  });
});

describe("rejects bad configuration", () => {
  it("throws when both STRAVA_TOKEN_KEYS and STRAVA_TOKEN_KEY are empty", async () => {
    setEnv({});
    await expect(encryptStravaToken("hello")).rejects.toBeInstanceOf(TokenCryptoError);
  });

  it("throws when the key is the committed placeholder (config.ts default)", async () => {
    setEnv({ STRAVA_TOKEN_KEY: "dev-only-replace-with-32-bytes-from-secrets-token-hex-32" });
    await expect(encryptStravaToken("hello")).rejects.toBeInstanceOf(TokenCryptoError);
  });

  it("throws when an entry's key is the env-template placeholder", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: "1:replace-with-32-byte-random-key" });
    await expect(encryptStravaToken("hello")).rejects.toBeInstanceOf(TokenCryptoError);
  });

  it("throws when a key is too short (under 32 bytes)", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: "1:" + "ab".repeat(8) }); // 16 bytes
    await expect(encryptStravaToken("hello")).rejects.toThrowError(/AES-256/);
  });

  it("throws when a key is non-hex", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: "1:" + "z".repeat(64) });
    await expect(encryptStravaToken("hello")).rejects.toThrowError(/valid hex/);
  });

  it("throws when STRAVA_TOKEN_KEYS has a non-positive version", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `0:${KEY_V1}` });
    await expect(encryptStravaToken("hello")).rejects.toThrowError(/positive integer/);
  });

  it("throws when STRAVA_TOKEN_KEYS has a duplicate version", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1},1:${KEY_V2}` });
    await expect(encryptStravaToken("hello")).rejects.toThrowError(/duplicate version/);
  });

  it("throws when an entry is missing the colon", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: KEY_V1 });
    await expect(encryptStravaToken("hello")).rejects.toThrowError(/<version>:<hex>/);
  });

  it("throws when plaintext is empty", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1}` });
    await expect(encryptStravaToken("")).rejects.toThrowError(/non-empty/);
  });
});

describe("decrypt — error paths", () => {
  it("rejects unknown format_version", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1}` });
    const { ciphertext } = await encryptStravaToken("hello");
    const tampered = "99" + ciphertext.slice(1); // change format_version to "99"
    await expect(decryptStravaToken(tampered)).rejects.toThrowError(/format_version/);
  });

  it("rejects unknown key_version", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1}` });
    const { ciphertext } = await encryptStravaToken("hello");
    setEnv({ STRAVA_TOKEN_KEYS: `2:${KEY_V2}` }); // remove v1
    await expect(decryptStravaToken(ciphertext)).rejects.toThrowError(/unknown key_version/);
  });

  it("rejects malformed envelope (wrong segment count)", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1}` });
    await expect(decryptStravaToken("only:three:segments")).rejects.toThrowError(
      /5 colon-separated segments/,
    );
  });

  it("rejects empty envelope", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1}` });
    await expect(decryptStravaToken("")).rejects.toThrowError(/non-empty/);
  });

  it("rejects envelope with wrong IV length", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1}` });
    const { ciphertext } = await encryptStravaToken("hello");
    const parts = ciphertext.split(":");
    // Replace IV segment with a 4-byte base64url string.
    const badIv = Buffer.from(new Uint8Array(4)).toString("base64url");
    const tampered = [parts[0], parts[1], badIv, parts[3], parts[4]].join(":");
    await expect(decryptStravaToken(tampered)).rejects.toThrowError(/iv must be 12 bytes/);
  });

  it("rejects tampered ciphertext (auth-tag mismatch)", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1}` });
    const { ciphertext } = await encryptStravaToken("hello");
    const parts = ciphertext.split(":");
    // Flip the last byte of the ciphertext segment (decode, mutate, re-encode).
    const ctBytes = Buffer.from(parts[3], "base64url");
    ctBytes[ctBytes.length - 1] ^= 0x01;
    const tamperedCt = ctBytes.toString("base64url");
    const tampered = [parts[0], parts[1], parts[2], tamperedCt, parts[4]].join(":");
    await expect(decryptStravaToken(tampered)).rejects.toThrowError(/auth-tag/);
  });

  it("rejects tampered auth tag", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1}` });
    const { ciphertext } = await encryptStravaToken("hello");
    const parts = ciphertext.split(":");
    const tagBytes = Buffer.from(parts[4], "base64url");
    tagBytes[0] ^= 0x01;
    const tamperedTag = tagBytes.toString("base64url");
    const tampered = [parts[0], parts[1], parts[2], parts[3], tamperedTag].join(":");
    await expect(decryptStravaToken(tampered)).rejects.toThrowError(/auth-tag/);
  });

  it("decrypting with a different key fails (wrong-key as auth-tag failure)", async () => {
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V1}` });
    const { ciphertext } = await encryptStravaToken("hello");
    setEnv({ STRAVA_TOKEN_KEYS: `1:${KEY_V2}` }); // same version, different bytes
    await expect(decryptStravaToken(ciphertext)).rejects.toThrowError(/auth-tag/);
  });
});
