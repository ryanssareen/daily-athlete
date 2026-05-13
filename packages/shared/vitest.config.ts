import { defineConfig } from "vitest/config";

// Pure-Zod tests for the shared row contracts. No DB, no Supabase, no
// jsdom -- these are static schema-validation checks against representative
// row shapes. They can be parallelised freely; nothing is shared between
// files.

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
