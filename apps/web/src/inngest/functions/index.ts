// Registry of Inngest functions served by apps/web. Phase A bootstraps this
// as an empty array; Phase C (backfill) and Phase D (webhook hydration +
// matcher) register against it.
//
// New functions are added via:
//   import { someFn } from "./some-fn";
//   export const functions = [someFn];

import type { InngestFunction } from "inngest";

export const functions: InngestFunction.Any[] = [];
