// Route tests for GET /api/admin/backups/[id]/download. Mocks the gate, admin
// client (row lookup + Storage download), and audit; uses REAL backup-crypto so
// the decrypt-and-stream path is verified end-to-end.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.BACKUP_ENCRYPTION_KEYS = `1:${"1".repeat(64)}`;
});

const mocks = vi.hoisted(() => ({
  gate: null as unknown,
  row: null as Record<string, unknown> | null,
  downloadData: null as { arrayBuffer: () => Promise<ArrayBuffer> } | null,
}));

vi.mock("@/auth/admin-guard", () => ({
  requireAdmin: vi.fn(async () => mocks.gate),
}));
vi.mock("@/db/admin-audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: () =>
                  Promise.resolve({ data: mocks.row, error: null }),
              };
            },
          };
        },
      };
    },
    storage: {
      from() {
        return {
          download: () =>
            Promise.resolve({ data: mocks.downloadData, error: null }),
        };
      },
    },
  }),
}));

import { encryptBackup } from "@/admin/backup-crypto";

async function invoke(id = "b1"): Promise<Response> {
  const { GET } = await import("../route");
  return GET(
    new Request(`http://localhost:3000/api/admin/backups/${id}/download`),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate = { ok: true, sessionId: "sess-1" };
  mocks.row = null;
  mocks.downloadData = null;
});

describe("GET /api/admin/backups/[id]/download", () => {
  it("404 when the row is missing", async () => {
    expect((await invoke()).status).toBe(404);
  });

  it("404 when the backup is not successful", async () => {
    mocks.row = {
      id: "b1",
      storage_path: "b1.ndjson.gz.enc",
      key_version: 1,
      status: "failed",
    };
    expect((await invoke()).status).toBe(404);
  });

  it("streams the decrypted gzipped artifact on success", async () => {
    const plaintext = Buffer.from("gzipped-ndjson-bytes-here");
    const { ciphertext, keyVersion } = encryptBackup(new Uint8Array(plaintext));
    mocks.row = {
      id: "b1",
      storage_path: "b1.ndjson.gz.enc",
      key_version: keyVersion,
      status: "success",
    };
    const ab = ciphertext.buffer.slice(
      ciphertext.byteOffset,
      ciphertext.byteOffset + ciphertext.byteLength
    ) as ArrayBuffer;
    mocks.downloadData = { arrayBuffer: async () => ab };

    const res = await invoke();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(
      "backup-b1.ndjson.gz"
    );
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(plaintext)).toBe(true);
  });
});
