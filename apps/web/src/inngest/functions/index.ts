// Registry of Inngest functions served by apps/web.
// The admin backup export (Unit 4) is the first live function; it runs the
// on-demand encrypted export off the request path.

import type { InngestFunction } from "inngest";

import { adminBackupExport } from "./admin-backup-export";

export const functions: InngestFunction.Any[] = [adminBackupExport];
