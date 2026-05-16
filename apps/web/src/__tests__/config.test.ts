// Tests for the apps/web boot-time config validator.
//
// The module evaluates loadConfig() eagerly at import time and exports the
// result as `config`. To exercise different env states each test wipes env,
// applies a fresh map, then re-imports via vi.resetModules() + dynamic
// import. Failure-mode tests assert that the import itself rejects (the
// eager singleton's throw surfaces through the await).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_KEY =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

const baseProdEnv: Record<string, string> = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-stub",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-stub",
  STRAVA_CLIENT_ID: "12345",
  STRAVA_CLIENT_SECRET: "client-secret-stub",
  STRAVA_TOKEN_KEYS: `1:${VALID_KEY}`,
  STRAVA_WEBHOOK_VERIFY_TOKEN: "webhook-verify-token-stub",
  STRAVA_OAUTH_STATE_SIGNING_KEY: VALID_KEY,
  INNGEST_EVENT_KEY: "inngest-event-key",
  INNGEST_SIGNING_KEY: "inngest-signing-key",
};

async function importFresh(env: Record<string, string | undefined>) {
  vi.resetModules();
  const wipe = [
    "NODE_ENV",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "STRAVA_CLIENT_ID",
    "STRAVA_CLIENT_SECRET",
    "STRAVA_TOKEN_KEYS",
    "STRAVA_WEBHOOK_VERIFY_TOKEN",
    "STRAVA_OAUTH_STATE_SIGNING_KEY",
    "INNGEST_EVENT_KEY",
    "INNGEST_SIGNING_KEY",
  ];
  for (const k of wipe)
    delete (process.env as Record<string, string | undefined>)[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined)
      delete (process.env as Record<string, string | undefined>)[k];
    else process.env[k] = v;
  }
  const mod = await import("../config");
  // The production `config` export is a Proxy that defers `loadConfig()`
  // until first property access (build-safety: bundlers must not run the
  // validator at module load). The test harness pulls the validator call
  // forward so existing `await expect(importFresh(env)).rejects.toThrow(...)`
  // patterns still see invalid-env errors as promise rejections.
  mod.loadConfig();
  return mod;
}

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe("config validator -- production happy path", () => {
  it("returns a config object when all env vars are present and valid", async () => {
    const mod = await importFresh(baseProdEnv);
    expect(mod.config.nodeEnv).toBe("production");
    expect(mod.config.supabase.url).toBe("https://example.supabase.co");
    expect(mod.config.strava.clientId).toBe("12345");
    expect(mod.config.strava.tokenKeysRaw).toBe(`1:${VALID_KEY}`);
    expect(mod.config.strava.webhookVerifyToken).toBe(
      "webhook-verify-token-stub"
    );
    expect(mod.config.inngest.eventKey).toBe("inngest-event-key");
    expect(mod.config.inngest.signingKey).toBe("inngest-signing-key");
  });
});

describe("config validator -- production failure modes", () => {
  it("rejects when STRAVA_TOKEN_KEYS is missing entirely", async () => {
    const env: Record<string, string | undefined> = { ...baseProdEnv };
    delete env.STRAVA_TOKEN_KEYS;
    await expect(importFresh(env)).rejects.toThrow(
      /STRAVA_TOKEN_KEYS.*required in production/
    );
  });

  it("rejects when STRAVA_TOKEN_KEYS is the literal placeholder 'hex'", async () => {
    await expect(
      importFresh({ ...baseProdEnv, STRAVA_TOKEN_KEYS: "1:hex" })
    ).rejects.toThrow(/STRAVA_TOKEN_KEYS|placeholder|non-hex/i);
  });

  it("rejects when STRAVA_TOKEN_KEYS is all zeros", async () => {
    await expect(
      importFresh({
        ...baseProdEnv,
        STRAVA_TOKEN_KEYS: `1:${"0".repeat(64)}`,
      })
    ).rejects.toThrow(/STRAVA_TOKEN_KEYS|all-zero|zero/i);
  });

  it("rejects when STRAVA_TOKEN_KEYS key is too short", async () => {
    await expect(
      importFresh({ ...baseProdEnv, STRAVA_TOKEN_KEYS: "1:abc" })
    ).rejects.toThrow(/STRAVA_TOKEN_KEYS|length|hex|bytes/i);
  });

  it("rejects when STRAVA_TOKEN_KEYS has version 0", async () => {
    await expect(
      importFresh({
        ...baseProdEnv,
        STRAVA_TOKEN_KEYS: `0:${VALID_KEY}`,
      })
    ).rejects.toThrow(/STRAVA_TOKEN_KEYS.*version.*positive integer/i);
  });

  it("rejects when STRAVA_TOKEN_KEYS has a non-integer version", async () => {
    await expect(
      importFresh({
        ...baseProdEnv,
        STRAVA_TOKEN_KEYS: `abc:${VALID_KEY}`,
      })
    ).rejects.toThrow(/STRAVA_TOKEN_KEYS.*version.*positive integer/i);
  });

  it("rejects when STRAVA_TOKEN_KEYS has duplicate version numbers", async () => {
    const VALID_KEY_B =
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    await expect(
      importFresh({
        ...baseProdEnv,
        STRAVA_TOKEN_KEYS: `1:${VALID_KEY},1:${VALID_KEY_B}`,
      })
    ).rejects.toThrow(/STRAVA_TOKEN_KEYS.*duplicate version 1/i);
  });

  it("rejects when STRAVA_CLIENT_ID is missing", async () => {
    const env: Record<string, string | undefined> = { ...baseProdEnv };
    delete env.STRAVA_CLIENT_ID;
    await expect(importFresh(env)).rejects.toThrow(/STRAVA_CLIENT_ID/);
  });

  it("rejects when STRAVA_CLIENT_SECRET is the placeholder 'xxx'", async () => {
    await expect(
      importFresh({ ...baseProdEnv, STRAVA_CLIENT_SECRET: "xxx" })
    ).rejects.toThrow(/STRAVA_CLIENT_SECRET|placeholder/i);
  });

  it("rejects when STRAVA_WEBHOOK_VERIFY_TOKEN is empty", async () => {
    await expect(
      importFresh({ ...baseProdEnv, STRAVA_WEBHOOK_VERIFY_TOKEN: "" })
    ).rejects.toThrow(/STRAVA_WEBHOOK_VERIFY_TOKEN/);
  });

  it("rejects when STRAVA_OAUTH_STATE_SIGNING_KEY is missing", async () => {
    const env: Record<string, string | undefined> = { ...baseProdEnv };
    delete env.STRAVA_OAUTH_STATE_SIGNING_KEY;
    await expect(importFresh(env)).rejects.toThrow(
      /STRAVA_OAUTH_STATE_SIGNING_KEY/
    );
  });

  it("rejects when STRAVA_OAUTH_STATE_SIGNING_KEY is the placeholder 'hex'", async () => {
    await expect(
      importFresh({
        ...baseProdEnv,
        STRAVA_OAUTH_STATE_SIGNING_KEY: "hex",
      })
    ).rejects.toThrow(/STRAVA_OAUTH_STATE_SIGNING_KEY|placeholder|non-hex/i);
  });

  it("rejects when STRAVA_OAUTH_STATE_SIGNING_KEY is all-zeros", async () => {
    await expect(
      importFresh({
        ...baseProdEnv,
        STRAVA_OAUTH_STATE_SIGNING_KEY: "0".repeat(64),
      })
    ).rejects.toThrow(/STRAVA_OAUTH_STATE_SIGNING_KEY|all-zero/i);
  });

  it("rejects when STRAVA_OAUTH_STATE_SIGNING_KEY is the wrong length", async () => {
    await expect(
      importFresh({ ...baseProdEnv, STRAVA_OAUTH_STATE_SIGNING_KEY: "deadbeef" })
    ).rejects.toThrow(/STRAVA_OAUTH_STATE_SIGNING_KEY.*64 hex chars/i);
  });

  it("accumulates multiple errors into one message rather than failing on the first", async () => {
    const env: Record<string, string | undefined> = { ...baseProdEnv };
    delete env.STRAVA_CLIENT_ID;
    env.STRAVA_CLIENT_SECRET = "hex";
    try {
      await importFresh(env);
      throw new Error("should have thrown");
    } catch (err: unknown) {
      const message = (err as Error).message;
      expect(message).toMatch(/STRAVA_CLIENT_ID/);
      expect(message).toMatch(/STRAVA_CLIENT_SECRET/);
    }
  });
});

describe("config validator -- production failures (Phase C: Inngest keys required)", () => {
  it("rejects when INNGEST_EVENT_KEY is missing in production", async () => {
    const env: Record<string, string | undefined> = { ...baseProdEnv };
    delete env.INNGEST_EVENT_KEY;
    await expect(importFresh(env)).rejects.toThrow(
      /Inngest event key.*required in production/i
    );
  });

  it("rejects when INNGEST_SIGNING_KEY is missing in production", async () => {
    const env: Record<string, string | undefined> = { ...baseProdEnv };
    delete env.INNGEST_SIGNING_KEY;
    await expect(importFresh(env)).rejects.toThrow(
      /Inngest signing key.*required in production/i
    );
  });
});

describe("config validator -- non-production", () => {
  it("does not reject when Strava env is missing in development", async () => {
    const mod = await importFresh({
      NODE_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    });
    expect(mod.config.nodeEnv).toBe("development");
    expect(mod.config.strava.clientId).toBeUndefined();
    expect(mod.config.strava.tokenKeysRaw).toBeUndefined();
  });

  it("does not reject when Strava env contains placeholders in test", async () => {
    const mod = await importFresh({
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      STRAVA_CLIENT_ID: "",
      STRAVA_TOKEN_KEYS: "1:hex",
    });
    expect(mod.config.nodeEnv).toBe("test");
    // Shape still constructed; downstream code that actually uses these
    // values will error at use-time, which is the desired posture for
    // dev/test (don't block boot for unrelated reasons).
    expect(mod.config.strava.tokenKeysRaw).toBe("1:hex");
  });

  it("warns (does not reject) when supabase env is missing in development", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(importFresh({ NODE_ENV: "development" })).resolves
        .toBeTruthy();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("caches the parsed config so repeated loadConfig() calls return the same object", async () => {
    const mod = await importFresh(baseProdEnv);
    const a = mod.loadConfig();
    const b = mod.loadConfig();
    expect(a).toBe(b);
    // `mod.config` is a Proxy that defers to the same `loadConfig()` cache,
    // so identity comparison against the cached AppConfig isn't meaningful
    // (the Proxy is not `===` the target). Verify each top-level slice
    // returns the same reference instead.
    expect(mod.config.strava).toBe(a.strava);
    expect(mod.config.supabase).toBe(a.supabase);
    expect(mod.config.inngest).toBe(a.inngest);
  });
});

describe("config validator -- build-time safety (Vercel bundler / Next build)", () => {
  // Regression test for the build failure on PR #62: Vercel's Next.js build
  // bundles route handlers, which evaluates module-top-level code. If
  // `config` is an eager `const config = loadConfig()`, the bundler runs
  // the production validator -- and fails -- on every build, even though
  // the validator's real job is to gate request handling. The fix is to
  // keep `config` as a lazy Proxy that defers `loadConfig()` until first
  // property access. This test pins that property.
  it("does NOT throw at module import time even when production env is missing", async () => {
    vi.resetModules();
    const wipe = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "STRAVA_CLIENT_ID",
      "STRAVA_CLIENT_SECRET",
      "STRAVA_TOKEN_KEYS",
      "STRAVA_WEBHOOK_VERIFY_TOKEN",
      "STRAVA_OAUTH_STATE_SIGNING_KEY",
      "INNGEST_EVENT_KEY",
      "INNGEST_SIGNING_KEY",
    ];
    for (const k of wipe)
      delete (process.env as Record<string, string | undefined>)[k];
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    // Importing the module must succeed; the Proxy is constructed without
    // calling loadConfig().
    const mod = await import("../config");
    expect(mod.config).toBeDefined();
    expect(typeof mod.loadConfig).toBe("function");

    // First property access on `config` invokes the validator, which then
    // throws because production env is missing. This is the desired
    // request-time fail-fast.
    expect(() => mod.config.strava).toThrow(
      /Strava client id is required in production/
    );
  });
});
