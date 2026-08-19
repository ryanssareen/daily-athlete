// Registry of Inngest functions served by apps/web.
// The admin backup export (Unit 4) is the first live function; it runs the
// on-demand encrypted export off the request path.

import type { InngestFunction } from "inngest";

import { adaptiveDetectors } from "./adaptive-detectors";
import { adaptiveRun } from "./adaptive-run";
import { adminBackupExport } from "./admin-backup-export";
import { generatePlan } from "./generate-plan";
import { periodReviewDelivery } from "./period-review-delivery";
import { periodReviewScheduler } from "./period-review-scheduler";
import { weeklyReviewExpirySweeper } from "./weekly-review-expiry-sweeper";
import { weeklyReviewScheduler } from "./weekly-review-scheduler";

export const functions: InngestFunction.Any[] = [
  adminBackupExport,
  weeklyReviewExpirySweeper,
  weeklyReviewScheduler,
  adaptiveRun,
  adaptiveDetectors,
  generatePlan,
  periodReviewScheduler,
  periodReviewDelivery,
];
