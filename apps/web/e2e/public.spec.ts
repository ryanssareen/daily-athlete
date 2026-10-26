import { expect, test } from "@playwright/test";

test("sign-in page renders", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.locator("#email")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("signed-out visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/athlete");
  await expect(page).toHaveURL(/sign-in/);
});

test("wrong password shows an error and stays on sign-in", async ({ page }) => {
  await page.goto("/sign-in");
  await page.locator("#email").fill("nobody@example.com");
  await page.locator("#password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/sign-in/);
  await expect(page.locator("p.text-sm")).toContainText(/./);
});
