// Tests for restore. Mocks the supabase admin client to capture upserts; uses
// the REAL zlib so the gzip -> NDJSON parse path is exercised end to end.

import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/db/admin", () => ({ createAdminClient: () => fake.client }));

import {
  filterToUser,
  parseArchive,
  resolveUserId,
  RestoreError,
  restoreFromArchive,
} from "@/admin/backup-restore";

type Row = Record<string, unknown>;

/** Build the on-disk artifact shape: gzipped NDJSON of `{ t, r }` lines. */
function makeArchive(rows: Array<{ t: string; r: Row }>): Uint8Array {
  const ndjson = rows.map((x) => JSON.stringify(x)).join("\n") + "\n";
  const gz = gzipSync(Buffer.from(ndjson, "utf8"));
  return new Uint8Array(gz.buffer, gz.byteOffset, gz.byteLength);
}

interface Upsert {
  table: string;
  rows: Row[];
  onConflict: string | undefined;
}

function makeFakeClient(opts: { failTable?: string } = {}) {
  const upserts: Upsert[] = [];
  const client = {
    from(table: string) {
      return {
        upsert(rows: Row[], options?: { onConflict?: string }) {
          upserts.push({ table, rows, onConflict: options?.onConflict });
          if (opts.failTable === table) {
            return Promise.resolve({ error: { message: "boom" } });
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, upserts };
}

// Two athletes; the second only appears as a user + one workout.
const SAMPLE = [
  { t: "users", r: { id: "u1", email: "A@B.com" } },
  { t: "users", r: { id: "u2", email: "c@d.com" } },
  { t: "entitlements", r: { user_id: "u1", entitlement_key: "pro" } },
  { t: "completed_workouts", r: { id: "w1", athlete_id: "u1" } },
  { t: "completed_workouts", r: { id: "w2", athlete_id: "u2" } },
  { t: "planned_workouts", r: { id: "p1", athlete_id: "u1" } },
  { t: "workout_matches", r: { id: "m1", planned_workout_id: "p1", completed_workout_id: "w1" } },
];

afterEach(() => vi.clearAllMocks());

describe("parseArchive", () => {
  it("groups allow-listed rows by table and sets unknown tables aside", () => {
    const parsed = parseArchive(
      makeArchive([...SAMPLE, { t: "secret_table", r: { id: "x" } }])
    );
    expect(parsed.tables.get("users")).toHaveLength(2);
    expect(parsed.tables.get("workout_matches")).toHaveLength(1);
    expect([...parsed.unknownTables]).toEqual(["secret_table"]);
  });

  it("reads plain (non-gzipped) NDJSON too", () => {
    const ndjson = JSON.stringify({ t: "users", r: { id: "u1" } }) + "\n";
    const parsed = parseArchive(new Uint8Array(Buffer.from(ndjson, "utf8")));
    expect(parsed.tables.get("users")).toHaveLength(1);
  });

  it("rejects an empty archive", () => {
    expect(() => parseArchive(new Uint8Array(Buffer.from("\n\n", "utf8")))).toThrow(
      RestoreError
    );
  });

  it("rejects non-NDJSON", () => {
    const gz = gzipSync(Buffer.from("not json at all", "utf8"));
    expect(() => parseArchive(new Uint8Array(gz))).toThrow(/NDJSON/);
  });
});

describe("resolveUserId / filterToUser", () => {
  it("matches by email case-insensitively and by id", () => {
    const parsed = parseArchive(makeArchive(SAMPLE));
    expect(resolveUserId(parsed, "a@b.com")).toBe("u1");
    expect(resolveUserId(parsed, "u2")).toBe("u2");
  });

  it("throws user_not_found for an unknown user", () => {
    const parsed = parseArchive(makeArchive(SAMPLE));
    try {
      resolveUserId(parsed, "nobody@nowhere.com");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RestoreError);
      expect((e as RestoreError).code).toBe("user_not_found");
    }
  });

  it("narrows every table to one user, following workout_matches parents", () => {
    const parsed = parseArchive(makeArchive(SAMPLE));
    const scoped = filterToUser(parsed, "u1");
    expect(scoped.tables.get("users")?.map((r) => r.id)).toEqual(["u1"]);
    expect(scoped.tables.get("entitlements")).toHaveLength(1);
    expect(scoped.tables.get("completed_workouts")?.map((r) => r.id)).toEqual(["w1"]);
    expect(scoped.tables.get("workout_matches")).toHaveLength(1);
  });
});

describe("restoreFromArchive", () => {
  it("upserts every table parents-first with the right conflict targets", async () => {
    const h = makeFakeClient();
    fake.client = h.client;

    const summary = await restoreFromArchive(makeArchive(SAMPLE));

    // users must be upserted before its children.
    const order = h.upserts.map((u) => u.table);
    expect(order.indexOf("users")).toBeLessThan(order.indexOf("entitlements"));
    expect(order.indexOf("users")).toBeLessThan(order.indexOf("completed_workouts"));

    const entitlements = h.upserts.find((u) => u.table === "entitlements");
    expect(entitlements?.onConflict).toBe("user_id,entitlement_key");

    expect(summary.totalRows).toBe(7);
    expect(summary.restored.users).toBe(2);
    expect(summary.scopedToUserId).toBeNull();
  });

  it("restores only the scoped user's rows when username is given", async () => {
    const h = makeFakeClient();
    fake.client = h.client;

    const summary = await restoreFromArchive(makeArchive(SAMPLE), {
      username: "c@d.com",
    });

    expect(summary.scopedToUserId).toBe("u2");
    expect(summary.restored.users).toBe(1);
    expect(summary.restored.completed_workouts).toBe(1);
    // u2 has no entitlements / planned workouts in the sample.
    expect(summary.restored.entitlements).toBe(0);
    expect(summary.restored.planned_workouts).toBe(0);
  });

  it("surfaces a table_failed RestoreError when an upsert errors", async () => {
    const h = makeFakeClient({ failTable: "completed_workouts" });
    fake.client = h.client;

    await expect(restoreFromArchive(makeArchive(SAMPLE))).rejects.toMatchObject({
      code: "table_failed",
    });
  });
});
