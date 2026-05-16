// Registry of Inngest functions served by apps/web. Phase A bootstraps this
// as an empty array; Phase C (backfill) and Phase D (webhook hydration +
// matcher) register against it.
//
// New functions are added via:
//   import { someFn } from "./some-fn";
//   export const functions = [...functions, someFn];

import type { InngestFunction } from "inngest";

import { backfillStravaFn } from "./backfill-strava";
import { backfillWatchdog } from "./backfill-watchdog";

export const functions: InngestFunction.Any[] = [
  backfillStravaFn,
  backfillWatchdog,
];
