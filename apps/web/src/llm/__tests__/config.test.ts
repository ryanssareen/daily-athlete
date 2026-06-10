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
  "GROQ_API_KEY",
  "LLM_PROVIDER",
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
  it("warns (does not throw) when no LLM key is set in production", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { config } = await importFresh(baseProdEnv);
      expect(config.config.llm.anthropicApiKey).toBeUndefined();
      expect(config.config.llm.groqApiKey).toBeUndefined();
      expect(config.config.llm.model).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/No LLM API key/)
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("reads the keys and an LLM_MODEL override when present", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { config } = await importFresh({
        ...baseProdEnv,
        ANTHROPIC_API_KEY: "sk-ant-real",
        GROQ_API_KEY: "gsk_real",
        LLM_MODEL: "claude-sonnet-4-6",
      });
      expect(config.config.llm.anthropicApiKey).toBe("sk-ant-real");
      expect(config.config.llm.groqApiKey).toBe("gsk_real");
      expect(config.config.llm.model).toBe("claude-sonnet-4-6");
    } finally {
      warn.mockRestore();
    }
  });

  it("warns when GROQ_API_KEY does not look like a Groq key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await importFresh({ ...baseProdEnv, GROQ_API_KEY: "not-a-groq-key" });
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/GROQ_API_KEY does not look like a Groq key/)
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("warns when LLM_PROVIDER names a provider whose key is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { config } = await importFresh({
        ...baseProdEnv,
        GROQ_API_KEY: "gsk_real",
        LLM_PROVIDER: "anthropic",
      });
      expect(config.config.llm.provider).toBe("anthropic");
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing/)
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("ignores an unrecognized LLM_PROVIDER with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { config } = await importFresh({
        ...baseProdEnv,
        GROQ_API_KEY: "gsk_real",
        LLM_PROVIDER: "openai",
      });
      expect(config.config.llm.provider).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/LLM_PROVIDER "openai" is not recognized/)
      );
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
  it("returns a client when only ANTHROPIC_API_KEY is set", async () => {
    const { llm } = await importFresh({
      NODE_ENV: "test",
      ANTHROPIC_API_KEY: "sk-ant-real",
    });
    const client = llm.createLlmClient();
    expect(typeof client.generateStructured).toBe("function");
  });

  it("returns a client when only GROQ_API_KEY is set", async () => {
    const { llm } = await importFresh({
      NODE_ENV: "test",
      GROQ_API_KEY: "gsk_real",
    });
    const client = llm.createLlmClient();
    expect(typeof client.generateStructured).toBe("function");
  });

  it("prefers Anthropic when both keys are set and no LLM_PROVIDER pin", async () => {
    const { llm } = await importFresh({
      NODE_ENV: "test",
      ANTHROPIC_API_KEY: "sk-ant-real",
      GROQ_API_KEY: "gsk_real",
    });
    expect(llm.createLlmClient().constructor.name).toBe("AnthropicClient");
  });

  it("honors LLM_PROVIDER=groq when both keys are set", async () => {
    const { llm } = await importFresh({
      NODE_ENV: "test",
      ANTHROPIC_API_KEY: "sk-ant-real",
      GROQ_API_KEY: "gsk_real",
      LLM_PROVIDER: "groq",
    });
    expect(llm.createLlmClient().constructor.name).toBe("GroqClient");
  });

  it("throws a clear error when no key is configured", async () => {
    const { llm } = await importFresh({ NODE_ENV: "test" });
    expect(() => llm.createLlmClient()).toThrow(/No LLM provider configured/);
  });

  it("treats a placeholder Anthropic key as absent and selects Groq", async () => {
    const { llm } = await importFresh({
      NODE_ENV: "test",
      ANTHROPIC_API_KEY: "xxx",
      GROQ_API_KEY: "gsk_real",
    });
    expect(llm.createLlmClient().constructor.name).toBe("GroqClient");
  });

  it("throws when only placeholder keys are set", async () => {
    const { llm } = await importFresh({
      NODE_ENV: "test",
      ANTHROPIC_API_KEY: "xxx",
      GROQ_API_KEY: "",
    });
    expect(() => llm.createLlmClient()).toThrow(/No LLM provider configured/);
  });

  it("throws when LLM_PROVIDER pins a provider whose key is absent", async () => {
    const { llm } = await importFresh({
      NODE_ENV: "test",
      GROQ_API_KEY: "gsk_real",
      LLM_PROVIDER: "anthropic",
    });
    expect(() => llm.createLlmClient()).toThrow(/No LLM provider configured/);
  });
});
