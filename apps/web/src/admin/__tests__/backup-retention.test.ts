// Tests for prune + orphan reconciliation. Mocks the admin client + Storage;
// no live Supabase.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/db/admin", () => ({ createAdminClient: () => mocks.client }));

import { pruneBackups } from "@/admin/backup-retention";

interface FakeOpts {
  oldRows: { id: string; storage_path: string | null }[];
  liveRows: { id: string; storage_path: string | null }[];
  objects: { name: string; created_at: string }[];
}

function makeFake(opts: FakeOpts) {
  const removed: string[] = [];
  const deletedIds: unknown[] = [];
  const client = {
    from() {
      return {
        select() {
          return {
            lt: () => Promise.resolve({ data: opts.oldRows, error: null }),
            then: (res: (r: { data: unknown; error: null }) => void) =>
              res({ data: opts.liveRows, error: null }),
          };
        },
        delete() {
          return {
            eq: (_c: string, v: unknown) => {
              deletedIds.push(v);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
    storage: {
      from() {
        return {
          remove: (paths: string[]) => {
            removed.push(...paths);
            return Promise.resolve({ error: null });
          },
          list: () => Promise.resolve({ data: opts.objects, error: null }),
        };
      },
    },
  };
  return { client, removed, deletedIds };
}

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

beforeEach(() => vi.clearAllMocks());

describe("pruneBackups", () => {
  it("age-prunes old rows and their objects", async () => {
    const h = makeFake({
      oldRows: [{ id: "r1", storage_path: "r1.ndjson.gz.enc" }],
      liveRows: [],
      objects: [],
    });
    mocks.client = h.client;
    const result = await pruneBackups();
    expect(result.deletedRows).toBe(1);
    expect(result.deletedObjects).toBe(1);
    expect(h.removed).toContain("r1.ndjson.gz.enc");
    expect(h.deletedIds).toContain("r1");
  });

  it("removes orphan objects (no live row, past grace) but keeps tracked ones", async () => {
    const h = makeFake({
      oldRows: [],
      liveRows: [{ id: "r2", storage_path: "r2.ndjson.gz.enc" }],
      objects: [
        { name: "r2.ndjson.gz.enc", created_at: daysAgo(2) }, // tracked -> keep
        { name: "orphan.ndjson.gz.enc", created_at: daysAgo(3) }, // orphan -> remove
      ],
    });
    mocks.client = h.client;
    const result = await pruneBackups();
    expect(result.orphanObjectsRemoved).toBe(1);
    expect(h.removed).toContain("orphan.ndjson.gz.enc");
    expect(h.removed).not.toContain("r2.ndjson.gz.enc");
  });

  it("does not remove a fresh orphan still within the grace window", async () => {
    const h = makeFake({
      oldRows: [],
      liveRows: [],
      objects: [{ name: "fresh.ndjson.gz.enc", created_at: daysAgo(0) }],
    });
    mocks.client = h.client;
    const result = await pruneBackups();
    expect(result.orphanObjectsRemoved).toBe(0);
    expect(h.removed).not.toContain("fresh.ndjson.gz.enc");
  });

  it("flags live rows whose Storage object is missing", async () => {
    const h = makeFake({
      oldRows: [],
      liveRows: [{ id: "r3", storage_path: "r3.ndjson.gz.enc" }],
      objects: [],
    });
    mocks.client = h.client;
    const result = await pruneBackups();
    expect(result.rowsMissingObject).toBe(1);
  });
});
