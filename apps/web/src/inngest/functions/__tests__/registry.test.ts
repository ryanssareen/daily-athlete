// CI guard: every Inngest function file under inngest/functions/ must be wired
// into the served `functions[]` registry (index.ts). An unregistered function
// is a silent failure -- its cron never fires and its events are never handled
// (and inngest.send() no-ops in dev), so this turns the recurring footgun into
// a test failure. See docs/plans/2026-05-25-001-feat-ai-adaptive-plans-engine-plan.md (Unit 7).
//
// Mirrors the realtime-allowlist CI guard pattern.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const functionsDir = fileURLToPath(new URL("../", import.meta.url));

// Pre-existing functions intentionally not (yet) served. Tracked separately;
// NOT a place to park new adaptive-engine functions -- those must be registered.
const KNOWN_UNREGISTERED = new Set<string>([
  "backfill-strava", // pre-existing; registration tracked outside this plan
  "backfill-watchdog", // pre-existing; also has a Vercel-cron route variant
]);

describe("inngest functions registry", () => {
  it("registers every function file in index.ts", () => {
    const indexSource = readFileSync(`${functionsDir}index.ts`, "utf8");

    const functionFiles = readdirSync(functionsDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/, ""))
      .filter((name) => name !== "index" && !name.endsWith(".test"));

    const missing = functionFiles.filter(
      (name) =>
        !KNOWN_UNREGISTERED.has(name) &&
        !indexSource.includes(`from "./${name}"`),
    );

    expect(
      missing,
      `Inngest function file(s) not registered in functions/index.ts: ${missing.join(", ")}. ` +
        `Add the import + array entry, or (only for pre-existing exceptions) KNOWN_UNREGISTERED.`,
    ).toEqual([]);
  });
});
