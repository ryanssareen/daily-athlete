import "server-only";

// Core of the on-demand export. Reads an explicit allow-list of tables
// (paginated past the PostgREST max-rows cap), serialises to NDJSON, gzips,
// AES-256-GCM encrypts, uploads to a private Storage bucket at a deterministic
// path, and records the result on the pre-inserted admin_backups row.
//
// The artifact is a FULL PLAINTEXT PII DUMP of every allow-listed table — each
// entry below is a conscious decision. strava_tokens is excluded (encrypted
// secret blobs; the restore runbook documents the resulting lossiness); the
// admin_* tables are operational, not user data. Adding a table to the schema
// does NOT add it here — that's intentional (no silent PII-surface growth).

import { gzipSync } from "node:zlib";

import type { SupabaseClient } from "@supabase/supabase-js";

import { encryptBackup } from "@/admin/backup-crypto";
import { config } from "@/config";
import { createAdminClient } from "@/db/admin";

export const BACKUP_TABLES = [
  "users",
  "entitlements",
  "athlete_profiles",
  "coach_athlete_links",
  "plans",
  "planned_workouts",
  "completed_workouts",
  "workout_matches",
  "strava_raw_payloads",
] as const;

const PAGE_SIZE = 1000;
const BACKUPS_TABLE = "admin_backups";

export function backupStoragePath(backupId: string): string {
  return `${backupId}.ndjson.gz.enc`;
}

async function readAllRows(
  admin: SupabaseClient,
  table: string
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  // Page past PostgREST's max-rows cap; a naive .select() would silently
  // truncate a large table into a PARTIAL backup.
  for (let from = 0; ; from += PAGE_SIZE) {
    // service-role: full-table export (admin backup); intentional cross-user read.
    const { data, error } = await admin
      .from(table)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`export read "${table}" failed: ${error.message}`);
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

export interface ExportResult {
  backupId: string;
  tableCounts: Record<string, number>;
  sizeBytes: number;
  keyVersion: number;
}

/**
 * Run the export for a pre-inserted admin_backups row (status 'pending').
 * Transitions running -> success|failed. Idempotent on retry: the upload
 * overwrites, and the row update is keyed by id. On error marks the row failed
 * and rethrows so Inngest records the failure (R7).
 */
export async function runExport(backupId: string): Promise<ExportResult> {
  const admin = createAdminClient();
  const bucket = config.backups.bucket;

  // service-role: admin_backups is a service-role-only table.
  await admin
    .from(BACKUPS_TABLE)
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", backupId);

  try {
    const lines: string[] = [];
    const tableCounts: Record<string, number> = {};
    for (const table of BACKUP_TABLES) {
      const rows = await readAllRows(admin, table);
      tableCounts[table] = rows.length;
      for (const row of rows) lines.push(JSON.stringify({ t: table, r: row }));
    }
    const ndjson = lines.length ? `${lines.join("\n")}\n` : "";
    const gz = gzipSync(Buffer.from(ndjson, "utf8"));
    const { ciphertext, keyVersion } = encryptBackup(new Uint8Array(gz));
    const body = Buffer.from(ciphertext);

    const path = backupStoragePath(backupId);
    const { error: upErr } = await admin.storage
      .from(bucket)
      .upload(path, body, {
        contentType: "application/octet-stream",
        upsert: true, // idempotent on retry
      });
    if (upErr) throw new Error(`export upload failed: ${upErr.message}`);

    // service-role: admin_backups is a service-role-only table.
    await admin
      .from(BACKUPS_TABLE)
      .update({
        status: "success",
        storage_path: path,
        size_bytes: body.byteLength,
        key_version: keyVersion,
        table_counts: tableCounts,
        updated_at: new Date().toISOString(),
      })
      .eq("id", backupId);

    return { backupId, tableCounts, sizeBytes: body.byteLength, keyVersion };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown export error";
    await markBackupFailed(backupId, message);
    throw err;
  }
}

/** Mark a backup failed without clobbering an already-successful row. */
export async function markBackupFailed(
  backupId: string,
  reason: string
): Promise<void> {
  const admin = createAdminClient();
  // service-role: admin_backups is a service-role-only table.
  await admin
    .from(BACKUPS_TABLE)
    .update({
      status: "failed",
      error: reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", backupId)
    .neq("status", "success");
}
