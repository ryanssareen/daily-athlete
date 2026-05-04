import { expect, test } from "@playwright/test";

import {
  createConfirmedUser,
  deleteUser,
  makeRandomEmail,
  type TestUser,
} from "./helpers/supabase-admin";

test.describe("Password sign-in flow (covers the bug user reported)", () => {
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createConfirmedUser();
  });

  test.afterAll(async () => {
    if (user?.id) await deleteUser(user.id);
  });

  test("sign in with valid password lands on /roster (not bounced back to /sign-in)", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByPlaceholder("you@example.com").fill(user.email);
    await page.getByPlaceholder("Password").fill(user.password);
    await page.getByRole("button", { name: /^Sign in$/ }).click();

    await expect(page).toHaveURL(/\/roster$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /Roster/ })).toBeVisible();
  });

  test("session cookie persists across full reload of /roster", async ({ page, context }) => {
    // Reuse the same context: sign in once, then hard-reload /roster.
    await page.goto("/sign-in");
    await page.getByPlaceholder("you@example.com").fill(user.email);
    await page.getByPlaceholder("Password").fill(user.password);
    await page.getByRole("button", { name: /^Sign in$/ }).click();
    await expect(page).toHaveURL(/\/roster$/, { timeout: 20_000 });

    const cookies = await context.cookies();
    const sbAuthCookie = cookies.find((c) => /sb-.*-auth-token/.test(c.name));
    expect(sbAuthCookie, "Supabase auth cookie should be set in the browser").toBeTruthy();

    // Hard reload — the page is server-rendered; if the cookie didn't propagate,
    // the (coach) layout would bounce us to /sign-in.
    await page.reload();
    await expect(page).toHaveURL(/\/roster$/);
    await expect(page.getByRole("heading", { name: /Roster/ })).toBeVisible();
  });

  test("/roster without auth redirects to /sign-in", async ({ browser }) => {
    const ctx = await browser.newContext(); // fresh, unauthenticated
    const page = await ctx.newPage();
    await page.goto("/roster");
    await expect(page).toHaveURL(/\/sign-in$/);
    await ctx.close();
  });
});

test.describe("Password sign-up flow (mailer_autoconfirm = true)", () => {
  let signupEmail: string;

  test.afterAll(async () => {
    if (signupEmail) {
      const found = await fetch(
        `https://gukhwozgnunbqzllobbd.supabase.co/auth/v1/admin/users?email=${encodeURIComponent(signupEmail)}`,
        {
          headers: {
            apikey: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!}`,
          },
        },
      ).then((r) => r.json() as Promise<{ users?: Array<{ id: string; email?: string }> }>);
      const u = found.users?.find((x) => x.email?.toLowerCase() === signupEmail.toLowerCase());
      if (u) await deleteUser(u.id);
    }
  });

  test("sign up creates account and lands on /roster (no 'check inbox' screen)", async ({
    page,
  }) => {
    signupEmail = makeRandomEmail("e2e-signup");
    const password = `Pa$$w0rd-${Math.random().toString(36).slice(2, 12)}`;

    await page.goto("/sign-in");
    await page.getByRole("button", { name: /Don.t have an account/ }).click();
    await expect(
      page.getByRole("heading", { name: /Create your coach account/ }),
    ).toBeVisible();

    await page.getByPlaceholder("you@example.com").fill(signupEmail);
    await page.getByPlaceholder(/Choose a password/).fill(password);
    await page.getByRole("button", { name: /Create account/ }).click();

    await expect(page).toHaveURL(/\/roster$/, { timeout: 20_000 });
    // The "Check your inbox" SentState should NOT appear since autoconfirm is on.
    await expect(page.getByText(/Check your inbox/)).toHaveCount(0);
  });
});

test.describe("Magic-link request fires the right Supabase API call", () => {
  test("toggling to magic-link mode and submitting hits /auth/v1/otp", async ({ page }) => {
    await page.goto("/sign-in");
    await page
      .getByRole("button", { name: /Email me a one-time sign-in link instead/ })
      .click();

    const otpRequest = page.waitForRequest(
      (req) => req.url().includes("/auth/v1/otp") && req.method() === "POST",
      { timeout: 15_000 },
    );

    const email = `e2e-magic+${Date.now()}@da2-test.local`;
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.getByRole("button", { name: /Email me a sign-in link/ }).click();

    const req = await otpRequest;
    const body = JSON.parse(req.postData() ?? "{}") as { email?: string };
    expect(body.email).toBe(email);
    // Supabase puts emailRedirectTo on the URL as ?redirect_to=
    const reqUrl = new URL(req.url());
    const redirectTo = reqUrl.searchParams.get("redirect_to") ?? "";
    expect(redirectTo).toContain("da2-one.vercel.app/auth/callback");
    expect(redirectTo).toContain("next=");
    expect(decodeURIComponent(redirectTo)).toContain("/roster");
  });
});
