// Tests for the apps/web boot-time config validator.
//
// Like token-crypto, the module reads process.env once at first call. Each
// test mutates env and re-imports via vi.resetModules() to get a fresh
// validator state.

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
  INNGEST_EVENT_KEY: "inngest-event-key",
  INNGEST_SIGNING_KEY: "inngest-signing-key",
};

async function importFresh(env: Record<string, string | undefined>) {
  vi.resetModules();
  // Wipe every key we might set in any test so leftover state from a
  // previous import does not bleed in.
  const wipe = [
    "NODE_ENV",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "STRAVA_CLIENT_ID",
    "STRAVA_CLIENT_SECRET",
    "STRAVA_TOKEN_KEYS",
    "STRAVA_WEBHOOK_VERIFY_TOKEN",
    "INNGEST_EVENT_KEY",
    "INNGEST_SIGNING_KEY",
  ];
  for (const k of wipe) delete process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return await import("../config");
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

describe("config validator -- production", () => {
  it("returns a config object when all env vars are present and valid", async () => {
    const { loadConfig } = await importFresh(baseProdEnv);
    const cfg = loadConfig();
    expect(cfg.nodeEnv).toBe("production");
    expect(cfg.supabase.url).toBe("https://example.supabase.co");
    expect(cfg.strava.clientId).toBe("12345");
    expect(cfg.strava.tokenKeysRaw).toBe(`1:${VALID_KEY}`);
    expect(cfg.strava.webhookVerifyToken).toBe("webhook-verify-token-stub");
    expect(cfg.inngest.eventKey).toBe("inngest-event-key");
  });

  it("throws when STRAVA_TOKEN_KEYS is the literal placeholder 'hex'", async () => {
    const { loadConfig } = await importFresh({
      ...baseProdEnv,
      STRAVA_TOKEN_KEYS: "1:hex",
    });
    expect(() => loadConfig()).toThrow(/STRAVA_TOKEN_KEYS|placeholder/i);
  });

  it("throws when STRAVA_TOKEN_KEYS is all zeros", async () => {
    const { loadConfig } = await importFresh({
      ...baseProdEnv,
      STRAVA_TOKEN_KEYS: `1:${"0".repeat(64)}`,
    });
    expect(() => loadConfig()).toThrow(/STRAVA_TOKEN_KEYS|zero/i);
  });

  it("throws when STRAVA_TOKEN_KEYS key is too short", async () => {
    const { loadConfig } = await importFresh({
      ...baseProdEnv,
      STRAVA_TOKEN_KEYS: "1:abc",
    });
    expect(() => loadConfig()).toThrow(/STRAVA_TOKEN_KEYS|length|hex|bytes/i);
  });

  it("throws when STRAVA_CLIENT_ID is missing", async () => {
    const env: Record<string, string | undefined> = { ...baseProdEnv };
    delete env.STRAVA_CLIENT_ID;
    const { loadConfig } = await importFresh(env);
    expect(() => loadConfig()).toThrow(/STRAVA_CLIENT_ID/);
  });

  it("throws when STRAVA_CLIENT_SECRET is the placeholder 'xxx'", async () => {
    const { loadConfig } = await importFresh({
      ...baseProdEnv,
      STRAVA_CLIENT_SECRET: "xxx",
    });
    expect(() => loadConfig()).toThrow(/STRAVA_CLIENT_SECRET|placeholder/i);
  });

  it("throws when STRAVA_WEBHOOK_VERIFY_TOKEN is empty", async () => {
    const { loadConfig } = await importFresh({
      ...baseProdEnv,
      STRAVA_WEBHOOK_VERIFY_TOKEN: "",
    });
    expect(() => loadConfig()).toThrow(/STRAVA_WEBHOOK_VERIFY_TOKEN/);
  });

  it("accumulates multiple errors into one message rather than failing on the first", async () => {
    const env: Record<string, string | undefined> = { ...baseProdEnv };
    delete env.STRAVA_CLIENT_ID;
    env.STRAVA_CLIENT_SECRET = "hex";
    const { loadConfig } = await importFresh(env);
    try {
      loadConfig();
      throw new Error("should have thrown");
    } catch (err: unknown) {
      const message = (err as Error).message;
      expect(message).toMatch(/STRAVA_CLIENT_ID/);
      expect(message).toMatch(/STRAVA_CLIENT_SECRET/);
    }
  });
});

describe("config validator -- non-production", () => {
  it("does not throw when Strava env is missing in development", async () => {
    const { loadConfig } = await importFresh({
      NODE_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    });
    const cfg = loadConfig();
    expect(cfg.nodeEnv).toBe("development");
    expect(cfg.strava.clientId).toBeUndefined();
    expect(cfg.strava.tokenKeysRaw).toBeUndefined();
  });

  it("does not throw when Strava env contains placeholders in test", async () => {
    const { loadConfig } = await importFresh({
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      STRAVA_CLIENT_ID: "",
      STRAVA_TOKEN_KEYS: "1:hex",
    });
    const cfg = loadConfig();
    expect(cfg.nodeEnv).toBe("test");
    // The shape is still constructed; downstream code that actually uses
    // these values will error at use-time, which is the desired posture for
    // dev/test (don't block boot for unrelated reasons).
    expect(cfg.strava.tokenKeysRaw).toBe("1:hex");
  });

  it("warns (does not throw) when supabase env is missing in development", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { loadConfig } = await importFresh({ NODE_ENV: "development" });
      expect(() => loadConfig()).not.toThrow();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("caches the parsed config so repeated calls return the same object", async () => {
    const { loadConfig } = await importFresh(baseProdEnv);
    const a = loadConfig();
    const b = loadConfig();
    expect(a).toBe(b);
  });
});
