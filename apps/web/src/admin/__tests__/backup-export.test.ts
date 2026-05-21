// Tests for the export orchestration. Mocks the supabase admin client (DB +
// Storage) so no live Supabase is needed; uses the REAL backup-crypto + zlib so
// the artifact is verified by a decrypt -> gunzip -> NDJSON round-trip.

import { gunzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.BACKUP_ENCRYPTION_KEYS = `1:${"1".repeat(64)}`;
});

const fake = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/db/admin", () => ({ createAdminClient: () => fake.client }));

import { decryptBackup } from "@/admin/backup-crypto";
import {
  BACKUP_TABLES,
  backupStoragePath,
  runExport,
} from "@/admin/backup-export";

interface FakeOpts {
  tables: Record<string, Record<string, unknown>[]>;
  uploadError?: { message: string } | null;
}

function makeFake(opts: FakeOpts) {
  const updates: Record<string, unknown>[] = [];
  let uploaded: { path: string; body: Buffer } | null = null;
  const client = {
    from(table: string) {
      return {
        select() {
          return {
            range(from: number, to: number) {
              const rows = opts.tables[table] ?? [];
              return Promise.resolve({
                data: rows.slice(from, to + 1),
                error: null,
              });
            },
          };
        },
        update(obj: Record<string, unknown>) {
          const chain = {
            eq: () => chain,
            neq: () => chain,
            then: (res: (r: { error: null }) => void) => {
              updates.push(obj);
              res({ error: null });
            },
          };
          return chain;
        },
      };
    },
    storage: {
      from() {
        return {
          upload(path: string, body: Buffer) {
            uploaded = { path, body };
            return Promise.resolve(
              opts.uploadError
                ? { data: null, error: opts.uploadError }
                : { data: { path }, error: null }
            );
          },
        };
      },
    },
  };
  return { client, updates, getUploaded: () => uploaded };
}

beforeEach(() => {
  process.env.BACKUP_ENCRYPTION_KEYS = `1:${"1".repeat(64)}`;
});
afterEach(() => vi.clearAllMocks());

describe("runExport", () => {
  it("exports allow-listed tables to an encrypted gzipped NDJSON artifact and marks success", async () => {
    const h = makeFake({
      tables: {
        users: [
          { id: "u1", email: "a@b.com" },
          { id: "u2", email: "c@d.com" },
        ],
        entitlements: [{ user_id: "u1", tier: "pro" }],
      },
    });
    fake.client = h.client;

    const result = await runExport("backup-123");

    expect(result.tableCounts.users).toBe(2);
    expect(result.tableCounts.entitlements).toBe(1);
    for (const t of BACKUP_TABLES) {
      expect(result.tableCounts[t]).toBeGreaterThanOrEqual(0);
    }

    const up = h.getUploaded();
    expect(up?.path).toBe(backupStoragePath("backup-123"));

    // Round-trip: decrypt -> gunzip -> NDJSON contains the rows.
    const ndjson = gunzipSync(
      decryptBackup(new Uint8Array(up!.body), result.keyVersion)
    ).toString("utf8");
    expect(ndjson).toContain('"email":"a@b.com"');
    expect(ndjson.trim().split("\n")).toHaveLength(3); // 2 users + 1 entitlement

    const last = h.updates.at(-1);
    expect(last?.status).toBe("success");
    expect(last?.storage_path).toBe(backupStoragePath("backup-123"));
    expect(last?.key_version).toBe(result.keyVersion);

    // Return contract: counts/ids only — never rows/PII/paths-with-PII
    // (Inngest stores step returns unencrypted).
    expect(Object.keys(result).sort()).toEqual([
      "backupId",
      "keyVersion",
      "sizeBytes",
      "tableCounts",
    ]);
  });

  it("marks the row failed and rethrows when the upload fails", async () => {
    const h = makeFake({ tables: {}, uploadError: { message: "storage 500" } });
    fake.client = h.client;
    await expect(runExport("backup-err")).rejects.toThrow(/upload failed/);
    const last = h.updates.at(-1);
    expect(last?.status).toBe("failed");
    expect(String(last?.error)).toMatch(/storage 500/);
  });
});
