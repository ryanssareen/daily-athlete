import path from "node:path";

import { defineConfig } from "vitest/config";

// DB-backed tests run against the local Supabase Postgres (via `supabase start`).
// Node environment, no jsdom -- this is not UI testing.
//
// Pool `forks` (one process per test file) keeps DB connections cleanly scoped:
// each file gets its own supabase-js admin client and per-test test-user
// cleanup (see src/db/__tests__/setup.ts). Threads would share module state
// in ways that subtly leak.
//
// The `@/*` alias mirrors apps/web/tsconfig.json so imports like
// `@/security/token-crypto` resolve in tests the same way they do under
// `next dev` / `next build`.
//
// `include` now also covers `app/**/__tests__/**` so Next.js Route Handler
// tests (e.g. app/api/integrations/strava/connect/__tests__/route.test.ts)
// run alongside src-tree tests.

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    pool: "forks",
    include: [
      "src/**/__tests__/**/*.test.ts",
      "app/**/__tests__/**/*.test.ts",
    ],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Run files serially -- DB-backed tests share the local Supabase
    // instance and parallel writes would race on auth.users cleanup.
    fileParallelism: false,
  },
});
