// First LIVE Inngest function: runs the on-demand admin backup export off the
// request path. The heavy work lives in @/admin/backup-export (testable
// without Inngest); this wrapper only wires steps, retries, and onFailure.
//
// The step return carries COUNTS/IDS ONLY (Inngest stores returns
// unencrypted) — never rows, signed URLs, or PII.

import { inngest } from "@/inngest/client";
import { markBackupFailed, runExport } from "@/admin/backup-export";

export const ADMIN_BACKUP_EXPORT_EVENT = "admin/backup.export.requested";

export const adminBackupExport = inngest.createFunction(
  {
    id: "admin-backup-export",
    retries: 1,
    // Backstop: if the run dies outside runExport's own try/catch, still mark
    // the row failed so the dashboard surfaces it (R7). Best-effort.
    onFailure: async ({ event }) => {
      try {
        const original = (event?.data as { event?: { data?: { backupId?: string } } })
          ?.event?.data;
        if (original?.backupId) {
          await markBackupFailed(original.backupId, "export failed after retries");
        }
      } catch {
        // Never let the failure handler itself throw.
      }
    },
  },
  { event: ADMIN_BACKUP_EXPORT_EVENT },
  async ({ event, step }) => {
    const backupId = (event.data as { backupId: string }).backupId;
    // counts/ids only in the return.
    return step.run("export", () => runExport(backupId));
  }
);
