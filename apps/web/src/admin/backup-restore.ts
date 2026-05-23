import "server-only";

// Restore an uploaded export artifact back into live Postgres. The inverse of
// backup-export.ts: take the gzipped NDJSON the download endpoint produces
// (lines of `{ t: table, r: row }`), and UPSERT every allow-listed table's
// rows back, parents first (FK-safe). An optional `username` scopes the restore
// to a single user's rows.
//
// DANGEROUS + NON-ATOMIC. Upsert (not truncate+insert) is the deliberate
// semantic: it re-inserts/updates the backed-up rows without deleting rows
// created after the backup — a merge-forward, not a wipe. There is no
// transaction across tables (the supabase-js client can't span one here), so a
// mid-run failure leaves earlier tables already restored. The route documents
// this; the restore runbook remains the path for a clean full/PITR restore.

import { gunzipSync } from "node:zlib";

import { BACKUP_TABLES } from "@/admin/backup-export";
import { createAdminClient } from "@/db/admin";

type BackupTable = (typeof BACKUP_TABLES)[number];
type Row = Record<string, unknown>;

interface TableMeta {
  /** Upsert conflict target — the table's primary key. */
  conflict: string;
  /** Columns whose value equals the target user id (for username scoping). */
  userCols: string[];
}

// Schema-derived (see supabase/migrations). Keeping this explicit — rather than
// guessing from row keys — is what makes a username-scoped restore correct.
export const RESTORE_TABLE_META: Record<BackupTable, TableMeta> = {
  users: { conflict: "id", userCols: ["id"] },
  entitlements: { conflict: "user_id,entitlement_key", userCols: ["user_id"] },
  athlete_profiles: { conflict: "user_id", userCols: ["user_id"] },
  coach_athlete_links: {
    conflict: "id",
    userCols: ["coach_user_id", "athlete_user_id"],
  },
  plans: { conflict: "id", userCols: ["athlete_id"] },
  planned_workouts: { conflict: "id", userCols: ["athlete_id"] },
  completed_workouts: { conflict: "id", userCols: ["athlete_id"] },
  // No direct user column — scoped via its planned/completed parents below.
  workout_matches: { conflict: "id", userCols: [] },
  strava_raw_payloads: { conflict: "id", userCols: ["user_id"] },
};

const UPSERT_BATCH = 500;
const KNOWN_TABLES = new Set<string>(BACKUP_TABLES);

/** A restore failure with a non-PII `code` safe to write to the audit log. */
export class RestoreError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "RestoreError";
    this.code = code;
  }
}

export interface ParsedBackup {
  /** Rows grouped by allow-listed table, in archive order. */
  tables: Map<BackupTable, Row[]>;
  /** Tables present in the archive but not in the allow-list (skipped). */
  unknownTables: Set<string>;
  /** Non-empty NDJSON lines seen. */
  totalLines: number;
}

export interface RestoreSummary {
  /** Rows upserted per table. */
  restored: Record<string, number>;
  totalRows: number;
  skippedUnknownTables: string[];
  /** Resolved user id when the restore was scoped, else null. */
  scopedToUserId: string | null;
}

export interface RestoreOptions {
  /** Email or user id; restore only that user's rows. Blank => everything. */
  username?: string | null;
}

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/** Gunzip if the bytes carry the gzip magic, else treat as UTF-8 NDJSON. */
function decodeArchive(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length >= 2 && buf[0] === GZIP_MAGIC_0 && buf[1] === GZIP_MAGIC_1) {
    try {
      return gunzipSync(buf).toString("utf8");
    } catch {
      throw new RestoreError("Backup file is not a valid gzip archive.", "bad_gzip");
    }
  }
  return buf.toString("utf8");
}

/** Parse an export artifact into rows-by-table. Throws RestoreError on garbage. */
export function parseArchive(bytes: Uint8Array): ParsedBackup {
  const text = decodeArchive(bytes);
  const tables = new Map<BackupTable, Row[]>();
  const unknownTables = new Set<string>();
  let totalLines = 0;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    totalLines++;

    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      throw new RestoreError("Backup file is not valid NDJSON.", "invalid_ndjson");
    }
    if (!entry || typeof entry !== "object") {
      throw new RestoreError("Backup file has a malformed line.", "invalid_ndjson");
    }
    const { t, r } = entry as { t?: unknown; r?: unknown };
    if (typeof t !== "string" || !r || typeof r !== "object") {
      throw new RestoreError(
        "Backup file is not a recognised export (expected {t, r} lines).",
        "invalid_ndjson"
      );
    }
    if (!KNOWN_TABLES.has(t)) {
      unknownTables.add(t);
      continue;
    }
    const key = t as BackupTable;
    const list = tables.get(key) ?? [];
    list.push(r as Row);
    tables.set(key, list);
  }

  if (totalLines === 0) {
    throw new RestoreError("Backup file is empty.", "empty");
  }
  return { tables, unknownTables, totalLines };
}

/** Resolve a username (email or id) to a user id present in the archive. */
export function resolveUserId(parsed: ParsedBackup, username: string): string {
  const needle = username.trim().toLowerCase();
  for (const row of parsed.tables.get("users") ?? []) {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) continue;
    const email = typeof row.email === "string" ? row.email.toLowerCase() : null;
    if (id.toLowerCase() === needle || email === needle) return id;
  }
  throw new RestoreError(
    `No user matching "${username}" was found in this backup.`,
    "user_not_found"
  );
}

/** Narrow a parsed archive to a single user's rows across all tables. */
export function filterToUser(parsed: ParsedBackup, userId: string): ParsedBackup {
  const tables = new Map<BackupTable, Row[]>();

  for (const [table, rows] of parsed.tables) {
    const cols = RESTORE_TABLE_META[table].userCols;
    if (cols.length === 0) continue; // workout_matches — handled below
    tables.set(
      table,
      rows.filter((r) => cols.some((c) => r[c] === userId))
    );
  }

  // workout_matches has no user column — keep rows whose planned/completed
  // parent was kept for this user.
  const matches = parsed.tables.get("workout_matches");
  if (matches) {
    const plannedIds = new Set((tables.get("planned_workouts") ?? []).map((r) => r.id));
    const completedIds = new Set((tables.get("completed_workouts") ?? []).map((r) => r.id));
    tables.set(
      "workout_matches",
      matches.filter(
        (r) =>
          plannedIds.has(r.planned_workout_id) ||
          completedIds.has(r.completed_workout_id)
      )
    );
  }

  return { tables, unknownTables: parsed.unknownTables, totalLines: parsed.totalLines };
}

/** Upsert a parsed archive into Postgres, parents first. */
export async function restoreParsed(
  parsed: ParsedBackup,
  scopedToUserId: string | null
): Promise<RestoreSummary> {
  const admin = createAdminClient();
  const restored: Record<string, number> = {};
  let totalRows = 0;

  // BACKUP_TABLES is already in dependency order (users first), so iterating it
  // upserts parents before children — FK-safe.
  for (const table of BACKUP_TABLES) {
    const rows = parsed.tables.get(table) ?? [];
    restored[table] = 0;
    if (rows.length === 0) continue;

    const { conflict } = RESTORE_TABLE_META[table];
    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
      const batch = rows.slice(i, i + UPSERT_BATCH);
      // service-role: restore re-imports a full backup artifact; cross-user by
      // design, gated + audited at the route.
      const { error } = await admin.from(table).upsert(batch, { onConflict: conflict });
      if (error) {
        throw new RestoreError(`Restore of "${table}" failed: ${error.message}`, "table_failed");
      }
      restored[table] += batch.length;
      totalRows += batch.length;
    }
  }

  return {
    restored,
    totalRows,
    skippedUnknownTables: [...parsed.unknownTables],
    scopedToUserId,
  };
}

/** Parse + (optionally) scope + restore an uploaded artifact. */
export async function restoreFromArchive(
  bytes: Uint8Array,
  opts: RestoreOptions = {}
): Promise<RestoreSummary> {
  let parsed = parseArchive(bytes);
  let scopedToUserId: string | null = null;

  const username = opts.username?.trim();
  if (username) {
    scopedToUserId = resolveUserId(parsed, username);
    parsed = filterToUser(parsed, scopedToUserId);
  }

  return restoreParsed(parsed, scopedToUserId);
}
