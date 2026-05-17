// Registry of Inngest functions served by apps/web.
// Backfill runs via Next.js after() + Vercel cron (Phase C); no Inngest
// functions are active. The /api/inngest route is retained for future use.

import type { InngestFunction } from "inngest";

export const functions: InngestFunction.Any[] = [];
