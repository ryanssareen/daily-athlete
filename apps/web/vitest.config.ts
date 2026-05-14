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
//
// `server-only` is mapped to a no-op shim: the `import 'server-only'`
// guard in @/db/admin and @/db/strava-tokens is a Next.js bundler-time
// safety net (throws if a client-component tree imports it). vitest runs
// in Node where there is no bundler, and the default export of
// `server-only` throws at import time. The alias below lets server-side
// modules under test load cleanly.

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./src/__tests__/server-only-shim.ts"),
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
