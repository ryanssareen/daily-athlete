// Tests for the LLM/Langfuse additions to apps/web/src/config.ts and the
// createLlmClient() factory. Mirrors the env-wipe + vi.resetModules + dynamic
// import pattern from src/__tests__/config.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_KEY =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

const baseProdEnv: Record<string, string> = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  STRAVA_CLIENT_ID: "12345",
  STRAVA_CLIENT_SECRET: "secret",
  STRAVA_TOKEN_KEYS: `1:${VALID_KEY}`,
  STRAVA_WEBHOOK_VERIFY_TOKEN: "verify",
  STRAVA_WEBHOOK_SUBSCRIPTION_ID: "99999",
  STRAVA_OAUTH_STATE_SIGNING_KEY: VALID_KEY,
  INNGEST_EVENT_KEY: "evt",
  INNGEST_SIGNING_KEY: "sign",
  ADMIN_SECRET: "admin-secret",
  ADMIN_SESSION_SIGNING_KEY: VALID_KEY,
  BACKUP_ENCRYPTION_KEYS: `1:${VALID_KEY}`,
};

const MANAGED_KEYS = [
  ...Object.keys(baseProdEnv),
  "ANTHROPIC_API_KEY",
  "LLM_MODEL",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_HOST",
];

async function importFresh(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of MANAGED_KEYS)
    delete (process.env as Record<string, string | undefined>)[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else process.env[k] = v;
  }
  const config = await import("../../config");
  const llm = await import("../index");
  config.loadConfig();
  return { config, llm };
}

const originalEnv = { ...process.env };
beforeEach(() => vi.resetModules());
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe("config — llm section", () => {
  it("warns (does not throw) when ANTHROPIC_API_KEY is missing in production", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { config } = await importFresh(baseProdEnv);
      expect(config.config.llm.anthropicApiKey).toBeUndefined();
      expect(config.config.llm.model).toBe("claude-opus-4-8");
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/ANTHROPIC_API_KEY missing/)
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("reads the key and an LLM_MODEL override when present", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { config } = await importFresh({
        ...baseProdEnv,
        ANTHROPIC_API_KEY: "sk-ant-real",
        LLM_MODEL: "claude-sonnet-4-6",
      });
      expect(config.config.llm.anthropicApiKey).toBe("sk-ant-real");
      expect(config.config.llm.model).toBe("claude-sonnet-4-6");
    } finally {
      warn.mockRestore();
    }
  });

  it("warns when INNGEST_SIGNING_KEY is missing in production but does NOT throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const env = { ...baseProdEnv };
      delete (env as Record<string, string | undefined>).INNGEST_SIGNING_KEY;
      const { config } = await importFresh(env);
      expect(config.config.inngest.signingKey).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/INNGEST_SIGNING_KEY missing/)
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("warns when Langfuse is only partially configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await importFresh({ ...baseProdEnv, LANGFUSE_PUBLIC_KEY: "pk-only" });
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/LANGFUSE_\* partially configured/)
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("createLlmClient", () => {
  it("returns a client when ANTHROPIC_API_KEY is set", async () => {
    const { llm } = await importFresh({
      NODE_ENV: "test",
      ANTHROPIC_API_KEY: "sk-ant-real",
    });
    const client = llm.createLlmClient();
    expect(typeof client.generateStructured).toBe("function");
  });

  it("throws a clear error when ANTHROPIC_API_KEY is absent", async () => {
    const { llm } = await importFresh({ NODE_ENV: "test" });
    expect(() => llm.createLlmClient()).toThrow(/ANTHROPIC_API_KEY not configured/);
  });
});
