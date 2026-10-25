import { expect, test } from "@playwright/test";
import { creds, signIn } from "./auth";

test.skip(!creds("COACH"), "E2E_COACH_* not set");

test.beforeEach(async ({ page }) => {
  await signIn(page, "COACH");
});

test("roster shows the linked QA athlete", async ({ page }) => {
  await page.goto("/roster");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("QA Athlete (test)").first()).toBeVisible();
});

test("coach can open the athlete detail page", async ({ page }) => {
  await page.goto("/roster");
  await page.getByText("QA Athlete (test)").first().click();
  await expect(page).toHaveURL(/\/athletes\//);
  await expect(page.locator("body")).not.toContainText(/application error/i);
});
