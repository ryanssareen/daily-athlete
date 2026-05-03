/**
 * Strava token encryption — AES-256-GCM via Web Crypto.
 *
 * Replaces the Wave-1 Python Fernet implementation. The ciphertext envelope
 * is intentionally NOT bitwise-compatible with the Python format (greenfield
 * production: zero existing rows). Documented in the pivot plan and in
 * docs/solutions/strava-token-encryption.md (lands in Unit 7).
 *
 * Envelope (UTF-8 string stored in BYTEA):
 *
 *   <format_version>:<key_version>:<iv_b64url>:<ciphertext_b64url>:<auth_tag_b64url>
 *
 * - format_version : envelope schema (currently "1"). Decoder MUST reject
 *                    unknown values rather than try to interpret them.
 * - key_version    : matches the highest "v:hex" entry from STRAVA_TOKEN_KEYS
 *                    that produced this ciphertext. Decoder uses it to look
 *                    up the right key.
 * - iv             : 12 random bytes (96-bit GCM IV). urlsafe base64, no pad.
 * - ciphertext     : AES-256-GCM ciphertext minus the auth tag. urlsafe b64.
 * - auth_tag       : 16 bytes. urlsafe base64, no padding.
 *
 * Web Crypto subtle.encrypt(AES-GCM) returns ciphertext||auth_tag in a single
 * ArrayBuffer; we slice the trailing 16 bytes to produce the separate envelope
 * segment. Decrypt concatenates them back before calling subtle.decrypt.
 *
 * Multi-key rotation contract (STRAVA_TOKEN_KEYS = "1:hex64,2:hex64,..."):
 *   - Encryption uses the HIGHEST configured version.
 *   - Decryption uses the version stamped in the envelope.
 *   - To rotate: add a new version with a fresh key, deploy, run the
 *     re-encrypt script (lands in the first Wave-2 unit that touches
 *     strava_tokens), verify zero rows still reference the old version,
 *     ONLY THEN remove the old key from the env.
 *   - Removing a key version while rows still reference it makes those
 *     rows undecryptable forever — there is no recovery.
 *
 * Legacy single-key `STRAVA_TOKEN_KEY` is treated as version 1 when
 * `STRAVA_TOKEN_KEYS` is empty.
 */
import { getConfig } from "@/server/config";

export class TokenCryptoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TokenCryptoError";
  }
}

const FORMAT_VERSION = "1";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_BYTES = 32; // AES-256

const PLACEHOLDER_TOKEN_KEY_VALUES = new Set<string>([
  // Keep in sync with config.ts. Both committed defaults must be rejected.
  "replace-with-32-byte-random-key",
  "dev-only-replace-with-32-bytes-from-secrets-token-hex-32",
]);

interface ParsedKey {
  version: number;
  bytes: Uint8Array; // 32 bytes (raw AES-256 key material)
}

interface KeyState {
  byVersion: Map<number, Uint8Array>;
  latestVersion: number;
}

let _state: KeyState | undefined;

/** Test/admin helper. Re-parse the env on next encrypt/decrypt call. */
export function resetKeyCache(): void {
  _state = undefined;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new TokenCryptoError(`key is not valid hex (length ${hex.length})`);
  }
  if (hex.length % 2 !== 0) {
    throw new TokenCryptoError("key hex length must be even");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function parseKey(entry: string): ParsedKey {
  const colonIdx = entry.indexOf(":");
  if (colonIdx <= 0) {
    throw new TokenCryptoError(
      `STRAVA_TOKEN_KEYS entry must be "<version>:<hex>" (got ${JSON.stringify(entry)})`,
    );
  }
  const versionStr = entry.slice(0, colonIdx).trim();
  const keyHex = entry.slice(colonIdx + 1).trim();

  const version = Number(versionStr);
  if (!Number.isInteger(version) || version <= 0) {
    throw new TokenCryptoError(
      `STRAVA_TOKEN_KEYS version must be a positive integer (got ${JSON.stringify(versionStr)})`,
    );
  }
  if (PLACEHOLDER_TOKEN_KEY_VALUES.has(keyHex)) {
    throw new TokenCryptoError(
      `STRAVA_TOKEN_KEYS version ${version} is still the committed placeholder; ` +
        "generate a real key with `openssl rand -hex 32`",
    );
  }
  const bytes = hexToBytes(keyHex);
  if (bytes.length !== KEY_BYTES) {
    throw new TokenCryptoError(
      `STRAVA_TOKEN_KEYS version ${version} has ${bytes.length}-byte key; ` +
        `AES-256 requires exactly ${KEY_BYTES} bytes (64 hex chars)`,
    );
  }
  return { version, bytes };
}

function loadState(): KeyState {
  if (_state) return _state;
  const cfg = getConfig();

  const entries = cfg.stravaTokenKeys
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Legacy single-key fallback: treat a non-placeholder STRAVA_TOKEN_KEY as v1.
  if (entries.length === 0) {
    if (!cfg.stravaTokenKey || PLACEHOLDER_TOKEN_KEY_VALUES.has(cfg.stravaTokenKey)) {
      throw new TokenCryptoError(
        "no Strava token keys configured: set STRAVA_TOKEN_KEYS=1:<64-hex> " +
          "or a non-placeholder STRAVA_TOKEN_KEY",
      );
    }
    entries.push(`1:${cfg.stravaTokenKey}`);
  }

  const byVersion = new Map<number, Uint8Array>();
  for (const entry of entries) {
    const parsed = parseKey(entry);
    if (byVersion.has(parsed.version)) {
      throw new TokenCryptoError(
        `STRAVA_TOKEN_KEYS has duplicate version ${parsed.version}`,
      );
    }
    byVersion.set(parsed.version, parsed.bytes);
  }

  const latestVersion = Math.max(...byVersion.keys());
  _state = { byVersion, latestVersion };
  return _state;
}

async function importAesKey(rawKey: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, usages);
}

function bytesToB64Url(bytes: Uint8Array): string {
  // Buffer is available on Node + Vercel Fluid. base64url omits padding.
  return Buffer.from(bytes).toString("base64url");
}

function b64UrlToBytes(s: string): Uint8Array {
  const buf = Buffer.from(s, "base64url");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export interface EncryptResult {
  /** UTF-8 envelope string. Store as BYTEA via Buffer.from(ciphertext, "utf8"). */
  ciphertext: string;
  /** Stamped on the row so future decrypts find the right key. */
  keyVersion: number;
}

/** Encrypt a Strava access/refresh token under the highest configured key. */
export async function encryptStravaToken(plaintext: string): Promise<EncryptResult> {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new TokenCryptoError("plaintext must be a non-empty string");
  }
  const state = loadState();
  const keyBytes = state.byVersion.get(state.latestVersion);
  if (!keyBytes) {
    throw new TokenCryptoError(
      `internal: latest version ${state.latestVersion} has no key bytes`,
    );
  }
  const key = await importAesKey(keyBytes, ["encrypt"]);

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const enc = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );

  const ctAndTag = new Uint8Array(enc);
  if (ctAndTag.length < AUTH_TAG_LENGTH) {
    throw new TokenCryptoError("encrypt produced output shorter than auth tag");
  }
  const ciphertextBytes = ctAndTag.slice(0, ctAndTag.length - AUTH_TAG_LENGTH);
  const authTagBytes = ctAndTag.slice(ctAndTag.length - AUTH_TAG_LENGTH);

  const envelope = [
    FORMAT_VERSION,
    String(state.latestVersion),
    bytesToB64Url(iv),
    bytesToB64Url(ciphertextBytes),
    bytesToB64Url(authTagBytes),
  ].join(":");

  return { ciphertext: envelope, keyVersion: state.latestVersion };
}

interface ParsedEnvelope {
  formatVersion: string;
  keyVersion: number;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  authTag: Uint8Array;
}

function parseEnvelope(envelope: string): ParsedEnvelope {
  const parts = envelope.split(":");
  if (parts.length !== 5) {
    throw new TokenCryptoError(
      `malformed envelope: expected 5 colon-separated segments, got ${parts.length}`,
    );
  }
  const [formatVersion, keyVersionStr, ivStr, ctStr, tagStr] = parts;
  if (formatVersion !== FORMAT_VERSION) {
    throw new TokenCryptoError(
      `unrecognized envelope format_version ${JSON.stringify(formatVersion)}; ` +
        `this code understands "${FORMAT_VERSION}" only`,
    );
  }
  const keyVersion = Number(keyVersionStr);
  if (!Number.isInteger(keyVersion) || keyVersion <= 0) {
    throw new TokenCryptoError(
      `malformed envelope: key_version must be a positive integer (got ${JSON.stringify(keyVersionStr)})`,
    );
  }
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  let authTag: Uint8Array;
  try {
    iv = b64UrlToBytes(ivStr);
    ciphertext = b64UrlToBytes(ctStr);
    authTag = b64UrlToBytes(tagStr);
  } catch (err) {
    throw new TokenCryptoError("malformed envelope: base64url decode failed", { cause: err });
  }
  if (iv.length !== IV_LENGTH) {
    throw new TokenCryptoError(
      `malformed envelope: iv must be ${IV_LENGTH} bytes (got ${iv.length})`,
    );
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new TokenCryptoError(
      `malformed envelope: auth_tag must be ${AUTH_TAG_LENGTH} bytes (got ${authTag.length})`,
    );
  }
  return { formatVersion, keyVersion, iv, ciphertext, authTag };
}

/** Decrypt an envelope produced by encryptStravaToken. */
export async function decryptStravaToken(envelope: string): Promise<string> {
  if (typeof envelope !== "string" || envelope.length === 0) {
    throw new TokenCryptoError("envelope must be a non-empty string");
  }
  const parsed = parseEnvelope(envelope);
  const state = loadState();
  const keyBytes = state.byVersion.get(parsed.keyVersion);
  if (!keyBytes) {
    throw new TokenCryptoError(
      `unknown key_version ${parsed.keyVersion}: not present in STRAVA_TOKEN_KEYS. ` +
        "Was this key removed before the row was re-encrypted?",
    );
  }
  const key = await importAesKey(keyBytes, ["decrypt"]);

  // Web Crypto wants ciphertext||auth_tag concatenated for AES-GCM.decrypt.
  const ctAndTag = new Uint8Array(parsed.ciphertext.length + parsed.authTag.length);
  ctAndTag.set(parsed.ciphertext, 0);
  ctAndTag.set(parsed.authTag, parsed.ciphertext.length);

  let plaintextBuf: ArrayBuffer;
  try {
    plaintextBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: parsed.iv },
      key,
      ctAndTag,
    );
  } catch (err) {
    // Web Crypto throws OperationError on auth-tag mismatch / tampered ciphertext.
    throw new TokenCryptoError("auth-tag verification failed (tampered or wrong key)", {
      cause: err,
    });
  }
  return new TextDecoder().decode(plaintextBuf);
}

/** Test helper: peek at the parsed key state without leaking key bytes. */
export function _internalsForTests(): { latestVersion: number; versions: number[] } {
  const state = loadState();
  return {
    latestVersion: state.latestVersion,
    versions: [...state.byVersion.keys()].sort((a, b) => a - b),
  };
}
