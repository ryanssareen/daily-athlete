import "server-only";

// Read-only view of Supabase's MANAGED backups via the Management API
// (GET /v1/projects/{ref}/database/backups). There is no on-demand
// create-backup API and no programmatic restore-to-fresh-DB; this surfaces
// status only. The operator-owned export (Unit 4) is the downloadable backup.
//
// Degrades gracefully: no token/ref => "unconfigured" (a note, not an error);
// API failure => "error" with the HTTP status. Never throws.

import { z } from "zod";

import { config } from "@/config";

const MANAGEMENT_BASE = "https://api.supabase.com";

export type ManagedBackupResult =
  | { state: "unconfigured" }
  | { state: "error"; status: number }
  | {
      state: "ok";
      pitrEnabled: boolean;
      walgEnabled: boolean;
      region: string | null;
      latestBackupAt: string | null;
      backupCount: number;
    };

// The Management API response shape varies by plan/version; parse leniently
// and only depend on the fields we render.
const BackupSchema = z
  .object({
    status: z.string().optional(),
    inserted_at: z.string().optional(),
    is_physical_backup: z.boolean().optional(),
  })
  .passthrough();

const ResponseSchema = z
  .object({
    region: z.string().optional(),
    walg_enabled: z.boolean().optional(),
    pitr_enabled: z.boolean().optional(),
    backups: z.array(BackupSchema).optional(),
    physical_backup_data: z
      .object({
        earliest_physical_backup_date_at: z.string().nullish(),
        latest_physical_backup_date_at: z.string().nullish(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

function latestOf(
  backups: { inserted_at?: string }[],
  physicalLatest: string | null | undefined
): string | null {
  const stamps = backups
    .map((b) => b.inserted_at)
    .filter((s): s is string => Boolean(s))
    .sort();
  return stamps.at(-1) ?? physicalLatest ?? null;
}

export async function getManagedBackupStatus(): Promise<ManagedBackupResult> {
  const token = config.admin.managementToken;
  const ref = config.admin.projectRef;
  if (!token || !ref) return { state: "unconfigured" };

  let res: Response;
  try {
    res = await fetch(
      `${MANAGEMENT_BASE}/v1/projects/${ref}/database/backups`,
      {
        headers: { Authorization: `Bearer ${token}` },
        // Token-bearing + slow-changing: never cache.
        cache: "no-store",
      }
    );
  } catch {
    return { state: "error", status: 0 };
  }

  if (!res.ok) return { state: "error", status: res.status };

  const parsed = ResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { state: "error", status: res.status };

  const data = parsed.data;
  const backups = data.backups ?? [];
  return {
    state: "ok",
    pitrEnabled: data.pitr_enabled ?? false,
    walgEnabled: data.walg_enabled ?? false,
    region: data.region ?? null,
    latestBackupAt: latestOf(
      backups,
      data.physical_backup_data?.latest_physical_backup_date_at
    ),
    backupCount: backups.length,
  };
}
