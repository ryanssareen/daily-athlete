import { expect, test } from "@playwright/test";
import { creds, signIn } from "./auth";

test.skip(!creds("ATHLETE"), "E2E_ATHLETE_* not set");

test.beforeEach(async ({ page }) => {
  await signIn(page, "ATHLETE");
});

// Fixture athlete has an onboarded profile, so sign-in lands on the dashboard.
test("dashboard loads without error", async ({ page }) => {
  await page.goto("/athlete");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/application error|something went wrong/i)).toHaveCount(0);
});

for (const path of ["/athlete/calendar", "/athlete/activities", "/athlete/plan", "/athlete/profile", "/athlete/settings"]) {
  test(`${path} renders`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBeLessThan(400);
    await expect(page).not.toHaveURL(/sign-in|onboarding/);
    await expect(page.locator("body")).not.toContainText(/application error/i);
  });
}

test("athlete cannot open the coach roster", async ({ page }) => {
  await page.goto("/roster");
  await expect(page).not.toHaveURL(/\/roster$/);
});
