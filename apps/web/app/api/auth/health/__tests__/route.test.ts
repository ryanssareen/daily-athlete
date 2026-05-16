import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../route";

describe("GET /api/auth/health", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    }
  });

  it("returns 503 when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("missing_env");
  });

  it("returns 503 when NEXT_PUBLIC_SUPABASE_URL is invalid", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not a url";

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid_url");
  });

  it("returns 200 when Supabase auth health responds", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, host: "example.supabase.co" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 503 when Supabase auth health returns a bad status", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("auth_unhealthy");
    expect(body.status).toBe(503);
  });

  it("returns 503 when Supabase auth health is unreachable", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ENOTFOUND")));

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("unreachable");
  });
});
