// Round-trip + rotation tests for the backup-artifact crypto. No DB/Storage —
// pure node:crypto.

import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY1 = "1".repeat(64);
const KEY2 = "2".repeat(64);

vi.hoisted(() => {
  process.env.BACKUP_ENCRYPTION_KEYS = `1:${"1".repeat(64)},2:${"2".repeat(64)}`;
});

import {
  __resetBackupKeyCacheForTests,
  currentBackupKeyVersion,
  decryptBackup,
  encryptBackup,
} from "../backup-crypto";

beforeEach(() => {
  __resetBackupKeyCacheForTests();
  process.env.BACKUP_ENCRYPTION_KEYS = `1:${KEY1},2:${KEY2}`;
});

const bytes = (s: string) => new Uint8Array(Buffer.from(s, "utf8"));
const str = (u: Uint8Array) => Buffer.from(u).toString("utf8");

describe("backup-crypto", () => {
  it("encrypts with the highest version and round-trips", () => {
    expect(currentBackupKeyVersion()).toBe(2);
    const plain = bytes("the quick brown fox \u{1f98a}");
    const { ciphertext, keyVersion } = encryptBackup(plain);
    expect(keyVersion).toBe(2);
    expect(str(decryptBackup(ciphertext, keyVersion))).toBe(
      "the quick brown fox \u{1f98a}"
    );
  });

  it("produces a different IV (ciphertext) each call", () => {
    const a = encryptBackup(bytes("same")).ciphertext;
    const b = encryptBackup(bytes("same")).ciphertext;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("decrypts an artifact written under an older key version", () => {
    __resetBackupKeyCacheForTests();
    process.env.BACKUP_ENCRYPTION_KEYS = `1:${KEY1}`;
    const { ciphertext, keyVersion } = encryptBackup(bytes("v1 data"));
    expect(keyVersion).toBe(1);
    // Rotate: add v2 as current; v1 artifact must still decrypt.
    __resetBackupKeyCacheForTests();
    process.env.BACKUP_ENCRYPTION_KEYS = `1:${KEY1},2:${KEY2}`;
    expect(currentBackupKeyVersion()).toBe(2);
    expect(str(decryptBackup(ciphertext, 1))).toBe("v1 data");
  });

  it("rejects a tampered authTag/ciphertext", () => {
    const { ciphertext, keyVersion } = encryptBackup(bytes("secret"));
    const tampered = Uint8Array.from(ciphertext);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptBackup(tampered, keyVersion)).toThrow();
  });

  it("throws for an unknown key version", () => {
    const { ciphertext } = encryptBackup(bytes("x"));
    expect(() => decryptBackup(ciphertext, 99)).toThrow(/key version 99/);
  });
});
