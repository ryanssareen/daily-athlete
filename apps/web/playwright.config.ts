import { defineConfig, devices } from "@playwright/test";

// Smoke suite for the deployed app. Point it at prod or a Vercel preview with
// E2E_BASE_URL; credentials come from E2E_ATHLETE_* / E2E_COACH_* (see e2e/README.md).
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://thedailyathlete.in",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
