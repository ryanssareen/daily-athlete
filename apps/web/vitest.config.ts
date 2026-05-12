import { defineConfig } from "vitest/config";

// DB-backed tests run against the local Supabase Postgres (via `supabase start`).
// Node environment, no jsdom -- this is not UI testing.
//
// Pool `forks` (one process per test file) keeps DB connections cleanly scoped:
// each file gets its own supabase-js admin client and per-test test-user
// cleanup (see src/db/__tests__/setup.ts). Threads would share module state
// in ways that subtly leak.
//
// Tests live under src/db/__tests__/ today; expand the include pattern when
// other test homes appear (component tests, route-handler tests, etc.).

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: ["src/db/__tests__/setup.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Run files serially -- DB-backed tests share the local Supabase
    // instance and parallel writes would race on auth.users cleanup.
    fileParallelism: false,
  },
});
