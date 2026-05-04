import { expect, test } from "@playwright/test";

test.describe("Landing page", () => {
  test("renders hero, sports row, feature triad, and footer", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/DA2/);
    await expect(page.getByRole("heading", { name: /Plans that adapt/ })).toBeVisible();
    await expect(page.getByText(/Built for/)).toBeVisible();
    await expect(page.getByText("Swim", { exact: true })).toBeVisible();
    await expect(page.getByText("Triathlon", { exact: true })).toBeVisible();
    await expect(page.getByText(/How it works/i)).toBeVisible();
    await expect(page.getByText(/Athletes train on iOS and Android/i)).toBeVisible();
  });

  test("CTA links go to da2-one.vercel.app and /sign-in (no mailto leftovers)", async ({
    page,
  }) => {
    await page.goto("/");
    const html = await page.content();
    expect(html).not.toContain("mailto:");

    const earlyAccess = page.getByRole("link", { name: /Get early athlete access/i });
    await expect(earlyAccess).toHaveAttribute("href", "https://da2-one.vercel.app/");

    const coachCta = page.getByRole("link", { name: /I.?m a coach/i });
    await expect(coachCta).toHaveAttribute("href", "/sign-in");

    const contact = page.getByRole("link", { name: "Contact" });
    await expect(contact).toHaveAttribute("href", "https://da2-one.vercel.app/");
  });

  test("clicking 'I'm a coach' navigates to /sign-in", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /I.?m a coach/i }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
