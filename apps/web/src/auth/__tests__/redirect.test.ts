import { afterEach, describe, expect, it, vi } from "vitest";

import { authCallbackUrl, getAuthRedirectOrigin } from "../redirect";

describe("auth redirect helpers", () => {
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const originalPublicVercelUrl = process.env.NEXT_PUBLIC_VERCEL_URL;
  const originalVercelUrl = process.env.VERCEL_URL;

  afterEach(() => {
    if (originalSiteUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
    }

    if (originalPublicVercelUrl === undefined) {
      delete process.env.NEXT_PUBLIC_VERCEL_URL;
    } else {
      process.env.NEXT_PUBLIC_VERCEL_URL = originalPublicVercelUrl;
    }

    if (originalVercelUrl === undefined) {
      delete process.env.VERCEL_URL;
    } else {
      process.env.VERCEL_URL = originalVercelUrl;
    }

    vi.unstubAllGlobals();
  });

  it("uses the current browser origin when running in the browser", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://configured.example";
    vi.stubGlobal("window", { location: { origin: "http://localhost:4000" } });

    expect(getAuthRedirectOrigin()).toBe("http://localhost:4000");
  });

  it("falls back to the configured site URL on the server", () => {
    delete process.env.NEXT_PUBLIC_VERCEL_URL;
    delete process.env.VERCEL_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://da2-one.vercel.app/";

    expect(getAuthRedirectOrigin()).toBe("https://da2-one.vercel.app");
  });

  it("normalizes Vercel hostnames without a scheme", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_VERCEL_URL;
    process.env.VERCEL_URL = "da2-git-google-auth-ryan.vercel.app";

    expect(getAuthRedirectOrigin()).toBe(
      "https://da2-git-google-auth-ryan.vercel.app",
    );
  });

  it("builds a safe callback URL with an encoded next path", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://da2-one.vercel.app";

    expect(authCallbackUrl("/roster")).toBe(
      "https://da2-one.vercel.app/auth/callback?next=%2Froster",
    );
    expect(authCallbackUrl("//evil.example")).toBe(
      "https://da2-one.vercel.app/auth/callback?next=%2F",
    );
  });
});
