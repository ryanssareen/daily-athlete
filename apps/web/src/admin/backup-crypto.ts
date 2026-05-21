import "server-only";

// AES-256-GCM encryption for export artifacts, with versioned keys. This is a
// deliberate parallel of src/security/token-crypto.ts (same cipher + layout)
// but keyed on BACKUP_ENCRYPTION_KEYS so backup-artifact encryption and
// Strava-token encryption rotate independently. Kept separate (rather than
// refactoring the proven token-crypto) to avoid coupling two security paths.
//
// BACKUP_ENCRYPTION_KEYS format: `1:<64-hex>,2:<64-hex>,...`. Highest version
// encrypts; all listed versions decrypt (roll-forward rotation).
//
// Ciphertext layout: iv(12) || authTag(16) || encrypted(N) — self-contained.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

type KeyMap = Map<number, Buffer>;
let cached: { keys: KeyMap; current: number } | null = null;

function isAllZero(buf: Buffer): boolean {
  return timingSafeEqual(buf, Buffer.alloc(buf.length, 0));
}

function loadKeys(): { keys: KeyMap; current: number } {
  if (cached) return cached;
  const raw = process.env.BACKUP_ENCRYPTION_KEYS;
  if (!raw || raw.trim() === "") {
    throw new Error(
      "BACKUP_ENCRYPTION_KEYS is not set. Format: `1:<64-hex>,2:<64-hex>,...`"
    );
  }
  const keys: KeyMap = new Map();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) {
      throw new Error(
        `BACKUP_ENCRYPTION_KEYS entry "${trimmed}" missing "version:hex" prefix`
      );
    }
    const version = Number(trimmed.slice(0, colon));
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(
        `BACKUP_ENCRYPTION_KEYS version "${trimmed.slice(0, colon)}" must be a positive integer`
      );
    }
    if (keys.has(version)) {
      throw new Error(`BACKUP_ENCRYPTION_KEYS contains duplicate version ${version}`);
    }
    const hex = trimmed.slice(colon + 1);
    if (!/^[0-9a-fA-F]*$/.test(hex)) {
      throw new Error(
        `BACKUP_ENCRYPTION_KEYS version ${version}: hex value contains non-hex characters`
      );
    }
    const key = Buffer.from(hex, "hex");
    if (key.length !== KEY_LEN) {
      throw new Error(
        `BACKUP_ENCRYPTION_KEYS version ${version}: key length ${key.length} bytes, expected ${KEY_LEN}`
      );
    }
    if (process.env.NODE_ENV === "production" && isAllZero(key)) {
      throw new Error(
        `BACKUP_ENCRYPTION_KEYS version ${version} is all-zero (placeholder); refusing to boot`
      );
    }
    keys.set(version, key);
  }
  if (keys.size === 0) {
    throw new Error("BACKUP_ENCRYPTION_KEYS parsed but contained zero key entries");
  }
  cached = { keys, current: Math.max(...keys.keys()) };
  return cached;
}

export function currentBackupKeyVersion(): number {
  return loadKeys().current;
}

export interface BackupEncryptResult {
  ciphertext: Uint8Array;
  keyVersion: number;
}

export function encryptBackup(plaintext: Uint8Array): BackupEncryptResult {
  const { keys, current } = loadKeys();
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

export function decryptBackup(ciphertext: Uint8Array, keyVersion: number): Uint8Array {
  const { keys } = loadKeys();
  const key = keys.get(keyVersion);
  if (!key) {
    throw new Error(
      `BACKUP_ENCRYPTION_KEYS does not contain key version ${keyVersion}; cannot decrypt`
    );
  }
  if (ciphertext.byteLength < IV_LEN + TAG_LEN) {
    throw new Error(`ciphertext too short: ${ciphertext.byteLength} bytes`);
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

/** Test-only: drop the memoised key map so a new env can take effect. */
export function __resetBackupKeyCacheForTests(): void {
  cached = null;
}
