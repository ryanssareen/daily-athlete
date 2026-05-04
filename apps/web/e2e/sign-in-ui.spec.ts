import { expect, test } from "@playwright/test";

test.describe("Sign-in page UI", () => {
  test("default mode is password — shows email + password fields and Google button", async ({
    page,
  }) => {
    await page.goto("/sign-in");

    await expect(page.getByRole("heading", { name: /Sign in to your roster/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
    await expect(page.getByPlaceholder("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Sign in$/ })).toBeVisible();

    // Toggle links visible
    await expect(page.getByRole("button", { name: /Don.t have an account/ })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Email me a one-time sign-in link instead/ }),
    ).toBeVisible();
  });

  test("toggle to sign-up mode swaps heading, button, password placeholder", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /Don.t have an account/ }).click();

    await expect(page.getByRole("heading", { name: /Create your coach account/ })).toBeVisible();
    await expect(page.getByPlaceholder(/Choose a password \(8\+ chars\)/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Create account/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Already have an account/ })).toBeVisible();
  });

  test("toggle to magic-link mode hides password and changes submit copy", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /Email me a one-time sign-in link instead/ }).click();

    await expect(page.getByPlaceholder("Password")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Email me a sign-in link/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Use email \+ password instead/ })).toBeVisible();
  });

  test("submit disabled until email + password are filled (password mode)", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    const submit = page.getByRole("button", { name: /^Sign in$/ });
    await expect(submit).toBeDisabled();

    await page.getByPlaceholder("you@example.com").fill("noone@example.com");
    await expect(submit).toBeDisabled();

    await page.getByPlaceholder("Password").fill("hunter22");
    await expect(submit).toBeEnabled();
  });

  test("invalid password sign-in surfaces error from Supabase", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByPlaceholder("you@example.com").fill("does-not-exist@da2-test.local");
    await page.getByPlaceholder("Password").fill("wrong-password-123");
    await page.getByRole("button", { name: /^Sign in$/ }).click();

    await expect(page.locator("p", { hasText: /Invalid login credentials|Email not confirmed|Email logins are disabled/ })).toBeVisible({
      timeout: 15_000,
    });
  });
});
