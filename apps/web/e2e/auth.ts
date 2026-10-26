import { expect, type Page } from "@playwright/test";

export type Role = "ATHLETE" | "COACH";

export function creds(role: Role): { email: string; password: string } | null {
  const email = process.env[`E2E_${role}_EMAIL`];
  const password = process.env[`E2E_${role}_PASSWORD`];
  return email && password ? { email, password } : null;
}

export async function signIn(page: Page, role: Role): Promise<void> {
  const c = creds(role);
  if (!c) throw new Error(`E2E_${role}_EMAIL / E2E_${role}_PASSWORD not set`);
  await page.goto("/sign-in");
  await page.locator("#email").fill(c.email);
  await page.locator("#password").fill(c.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}
