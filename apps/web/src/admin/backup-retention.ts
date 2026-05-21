import "server-only";

// Retention prune + orphan reconciliation for export artifacts. Run on a
// schedule (cron). Two passes:
//   1. Age-prune: delete rows (and their Storage objects) older than retention.
//   2. Orphan sweep: delete Storage objects with no live row past a grace
//      window, and flag rows whose object is missing. This reconciles either
//      half of a delete that failed mid-way (the deterministic id-derived path
//      makes row<->object linkable), so a separate "deleting" state isn't
//      needed.

import { config } from "@/config";
import { createAdminClient } from "@/db/admin";

const RETENTION_DAYS = 30;
const ORPHAN_GRACE_HOURS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PruneResult {
  deletedRows: number;
  deletedObjects: number;
  orphanObjectsRemoved: number;
  rowsMissingObject: number;
}

export async function pruneBackups(): Promise<PruneResult> {
  const admin = createAdminClient();
  const bucket = config.backups.bucket;
  const result: PruneResult = {
    deletedRows: 0,
    deletedObjects: 0,
    orphanObjectsRemoved: 0,
    rowsMissingObject: 0,
  };

  // --- 1. Age-prune ------------------------------------------------------
  const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString();
  // service-role: admin_backups is a service-role-only table.
  const { data: oldRows } = await admin
    .from("admin_backups")
    .select("id, storage_path")
    .lt("created_at", cutoff);
  for (const row of oldRows ?? []) {
    const path = row.storage_path as string | null;
    if (path) {
      const { error } = await admin.storage.from(bucket).remove([path]);
      if (!error) result.deletedObjects++;
    }
    await admin.from("admin_backups").delete().eq("id", row.id);
    result.deletedRows++;
  }

  // --- 2. Orphan sweep ---------------------------------------------------
  const { data: objects } = await admin.storage.from(bucket).list();
  // service-role: admin_backups is a service-role-only table.
  const { data: liveRows } = await admin
    .from("admin_backups")
    .select("id, storage_path");
  const livePaths = new Set(
    (liveRows ?? [])
      .map((r) => r.storage_path as string | null)
      .filter((p): p is string => Boolean(p))
  );
  const graceCutoff = Date.now() - ORPHAN_GRACE_HOURS * 60 * 60 * 1000;

  for (const obj of objects ?? []) {
    if (livePaths.has(obj.name)) continue;
    const created = obj.created_at ? new Date(obj.created_at).getTime() : 0;
    if (created && created > graceCutoff) continue; // still within grace
    const { error } = await admin.storage.from(bucket).remove([obj.name]);
    if (!error) result.orphanObjectsRemoved++;
  }

  const objectNames = new Set((objects ?? []).map((o) => o.name));
  for (const r of liveRows ?? []) {
    const path = r.storage_path as string | null;
    if (path && !objectNames.has(path)) {
      result.rowsMissingObject++;
      console.warn(
        "[backup-prune] row has no Storage object",
        JSON.stringify({ id: r.id })
      );
    }
  }

  return result;
}
