import { expect, test } from "@playwright/test";

const SUPABASE_URL = "https://gukhwozgnunbqzllobbd.supabase.co";

test.describe("Google OAuth provider wiring", () => {
  test("Supabase /authorize?provider=google → 302 to accounts.google.com with our client ID", async ({
    request,
  }) => {
    const res = await request.get(
      `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fda2-one.vercel.app%2Fauth%2Fcallback`,
      { maxRedirects: 0 },
    );
    expect(res.status()).toBe(302);
    const loc = new URL(res.headers()["location"]!);
    expect(loc.hostname).toBe("accounts.google.com");
    expect(loc.pathname).toBe("/o/oauth2/v2/auth");

    // Parameters Supabase should hand to Google
    expect(loc.searchParams.get("client_id")).toBe(
      "7331907591-v2647tf62gf5h8c1n5mjajme9255imes.apps.googleusercontent.com",
    );
    expect(loc.searchParams.get("redirect_uri")).toBe(
      `${SUPABASE_URL}/auth/v1/callback`,
    );
    expect(loc.searchParams.get("response_type")).toBe("code");
    const scope = loc.searchParams.get("scope") ?? "";
    expect(scope).toContain("email");
    expect(scope).toContain("profile");
  });

  test("clicking 'Continue with Google' on /sign-in initiates the OAuth flow", async ({
    page,
  }) => {
    await page.goto("/sign-in");

    // Don't actually follow the redirect to Google's domain — just verify
    // we navigate away from /sign-in toward Supabase /authorize.
    const navigationPromise = page.waitForRequest(
      (req) => req.url().includes("/auth/v1/authorize") && req.url().includes("provider=google"),
      { timeout: 15_000 },
    );

    await page.getByRole("button", { name: /Continue with Google/ }).click();

    const req = await navigationPromise;
    const url = new URL(req.url());
    expect(url.hostname).toBe("gukhwozgnunbqzllobbd.supabase.co");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toContain("da2-one.vercel.app/auth/callback");
  });
});
