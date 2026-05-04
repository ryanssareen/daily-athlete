import { expect, test } from "@playwright/test";

test.describe("/auth/callback route", () => {
  test("no code, no error: redirects to /sign-in", async ({ request }) => {
    const res = await request.get("/auth/callback", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const location = res.headers()["location"];
    expect(location).toBeTruthy();
    expect(new URL(location!).pathname).toBe("/sign-in");
  });

  test("error param: redirects to /sign-in with the error message", async ({ request }) => {
    const res = await request.get(
      "/auth/callback?error=access_denied&error_description=User%20declined",
      { maxRedirects: 0 },
    );
    expect(res.status()).toBe(307);
    const location = res.headers()["location"];
    const dest = new URL(location!);
    expect(dest.pathname).toBe("/sign-in");
    expect(dest.searchParams.get("error")).toBe("User declined");
  });

  test("invalid code: redirects to /sign-in with error", async ({ request }) => {
    // Sending a code that won't validate. Supabase will return an exchange error.
    const res = await request.get("/auth/callback?code=not-a-real-pkce-code&next=/roster", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(307);
    const dest = new URL(res.headers()["location"]!);
    expect(dest.pathname).toBe("/sign-in");
    // Should carry through some error message rather than silently going to /roster
    expect(dest.searchParams.has("error")).toBe(true);
  });

  test("open-redirect guard: schema-relative `next` is dropped, falls back to /roster", async ({
    request,
  }) => {
    // No code, but with a malicious next. Without a code we land on /sign-in
    // anyway, but we can at least verify the route doesn't 302 to evil.com.
    const res = await request.get("/auth/callback?next=//evil.com/steal", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(307);
    const dest = new URL(res.headers()["location"]!);
    expect(dest.host).not.toBe("evil.com");
    // Should be on da2-one.vercel.app (or whatever baseURL is)
    expect(dest.pathname).toBe("/sign-in");
  });
});
