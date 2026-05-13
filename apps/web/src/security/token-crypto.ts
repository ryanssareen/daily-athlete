// Strava token encryption: AES-256-GCM via node:crypto with versioned keys.
//
// STRAVA_TOKEN_KEYS format: `1:<64-hex>,2:<64-hex>,...`. The highest-numbered
// version is used for new encryptions; all listed versions are tried on
// decrypt. Each row stamps the key_version it was written under so rotation
// can roll forward incrementally.
//
// Ciphertext layout in the BYTEA column:
//   iv(12 bytes) || authTag(16 bytes) || encrypted(N bytes)
// Self-contained -- no separate auth-tag column.
//
// See AGENTS.md "Secrets" and docs/solutions/strava-token-crypto.md.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32; // 256 bits

type KeyMap = Map<number, Buffer>;

let cached: { keys: KeyMap; current: number } | null = null;

function isAllZero(buf: Buffer): boolean {
  // timingSafeEqual to avoid any cute side-channel via short-circuit on real
  // key material -- not strictly necessary for a placeholder check but
  // cheap and consistent with how we'd compare key bytes elsewhere.
  const zero = Buffer.alloc(buf.length, 0);
  return timingSafeEqual(buf, zero);
}

function parseEntry(entry: string): { version: number; key: Buffer } {
  const colon = entry.indexOf(":");
  if (colon === -1) {
    throw new Error(
      `STRAVA_TOKEN_KEYS entry "${entry}" missing "version:hex" prefix`
    );
  }
  const rawVersion = entry.slice(0, colon);
  const rawHex = entry.slice(colon + 1).trim();

  const version = Number(rawVersion);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(
      `STRAVA_TOKEN_KEYS version "${rawVersion}" must be a positive integer`
    );
  }

  // Production refuses placeholders before the length check so the error
  // names the placeholder clearly (more useful than "key length 3").
  if (
    process.env.NODE_ENV === "production" &&
    (rawHex === "hex" || rawHex === "xxx")
  ) {
    throw new Error(
      `STRAVA_TOKEN_KEYS version ${version} contains placeholder value "${rawHex}"; refusing to boot`
    );
  }

  if (!/^[0-9a-fA-F]*$/.test(rawHex)) {
    throw new Error(
      `STRAVA_TOKEN_KEYS version ${version}: hex value contains non-hex characters`
    );
  }

  let key: Buffer;
  try {
    key = Buffer.from(rawHex, "hex");
  } catch {
    throw new Error(
      `STRAVA_TOKEN_KEYS version ${version}: hex value is invalid`
    );
  }
  if (key.length !== KEY_LEN) {
    throw new Error(
      `STRAVA_TOKEN_KEYS version ${version}: key length ${key.length} bytes, expected ${KEY_LEN} bytes (256 bits)`
    );
  }
  if (process.env.NODE_ENV === "production" && isAllZero(key)) {
    throw new Error(
      `STRAVA_TOKEN_KEYS version ${version} is all-zero (placeholder); refusing to boot`
    );
  }

  return { version, key };
}

function loadKeys(): { keys: KeyMap; current: number } {
  if (cached) return cached;

  const raw = process.env.STRAVA_TOKEN_KEYS;
  if (!raw || raw.trim() === "") {
    throw new Error(
      "STRAVA_TOKEN_KEYS is not set. Format: `1:<64-hex>,2:<64-hex>,...`"
    );
  }

  const keys: KeyMap = new Map();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const { version, key } = parseEntry(trimmed);
    if (keys.has(version)) {
      throw new Error(
        `STRAVA_TOKEN_KEYS contains duplicate version ${version}`
      );
    }
    keys.set(version, key);
  }

  if (keys.size === 0) {
    throw new Error("STRAVA_TOKEN_KEYS parsed but contained zero key entries");
  }

  const current = Math.max(...keys.keys());
  cached = { keys, current };
  return cached;
}

export function currentKeyVersion(): number {
  return loadKeys().current;
}

export interface EncryptResult {
  ciphertext: Uint8Array;
  keyVersion: number;
}

export function encrypt(plaintext: Uint8Array): EncryptResult {
  const { keys, current } = loadKeys();
  // current is derived from keys.keys() inside loadKeys() and loadKeys()
  // throws on an empty map, so this lookup is provably non-null.
  const key = keys.get(current)!;

  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const out = Buffer.concat([iv, tag, enc]);
  return {
    ciphertext: new Uint8Array(out.buffer, out.byteOffset, out.byteLength),
    keyVersion: current,
  };
}

export function decrypt(
  ciphertext: Uint8Array,
  keyVersion: number
): Uint8Array {
  const { keys } = loadKeys();
  const key = keys.get(keyVersion);
  if (!key) {
    throw new Error(
      `STRAVA_TOKEN_KEYS does not contain key version ${keyVersion}; cannot decrypt`
    );
  }
  if (ciphertext.byteLength < IV_LEN + TAG_LEN) {
    throw new Error(
      `ciphertext too short: ${ciphertext.byteLength} bytes, need at least ${IV_LEN + TAG_LEN}`
    );
  }

  const buf = Buffer.from(
    ciphertext.buffer,
    ciphertext.byteOffset,
    ciphertext.byteLength
  );
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(enc), decipher.final()]);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

