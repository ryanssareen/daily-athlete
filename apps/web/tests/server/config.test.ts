import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError, _internals } from "@/server/config";

const { buildConfig } = _internals;

const realEnv = {
  APP_ENV: "production",
  SUPABASE_URL: "https://example-project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key-real-value",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-real-value",
  SUPABASE_JWT_ISSUER: "https://example-project.supabase.co/auth/v1",
  STRAVA_TOKEN_KEYS: "1:" + "a".repeat(40),
  CRON_SECRET: "x".repeat(40),
  TRUSTED_HOSTS: "api.example.com",
  CORS_ORIGINS: "https://example.com",
};

describe("config validation", () => {
  let snapshot: typeof process.env;
  beforeEach(() => {
    snapshot = { ...process.env };
  });
  afterEach(() => {
    process.env = snapshot;
  });

  it("development accepts placeholders / empty server-only values", () => {
    expect(() =>
      buildConfig({
        APP_ENV: "development",
      } as unknown as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it("test env also skips the production guard", () => {
    expect(() =>
      buildConfig({ APP_ENV: "test" } as unknown as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it("production rejects empty SUPABASE_JWT_JWKS_URL when SUPABASE_URL is also unset", () => {
    const env = { ...realEnv, SUPABASE_URL: "", SUPABASE_JWT_JWKS_URL: "" };
    expect(() => buildConfig(env as unknown as NodeJS.ProcessEnv)).toThrowError(
      /SUPABASE_JWT_JWKS_URL/,
    );
  });

  it("production derives SUPABASE_JWT_JWKS_URL from SUPABASE_URL when not set", () => {
    const cfg = buildConfig(realEnv as unknown as NodeJS.ProcessEnv);
    expect(cfg.supabaseJwtJwksUrl).toBe(
      "https://example-project.supabase.co/auth/v1/.well-known/jwks.json",
    );
  });

  it("production rejects empty SUPABASE_JWT_ISSUER", () => {
    const env = { ...realEnv, SUPABASE_JWT_ISSUER: "" };
    expect(() => buildConfig(env as unknown as NodeJS.ProcessEnv)).toThrowError(
      /SUPABASE_JWT_ISSUER/,
    );
  });

  it("production rejects placeholder SUPABASE_SERVICE_ROLE_KEY", () => {
    const env = {
      ...realEnv,
      SUPABASE_SERVICE_ROLE_KEY: _internals.PLACEHOLDER_SERVICE_KEY,
    };
    expect(() => buildConfig(env as unknown as NodeJS.ProcessEnv)).toThrowError(
      /SERVICE_ROLE_KEY/,
    );
  });

  it("production rejects empty STRAVA_TOKEN_KEYS when STRAVA_TOKEN_KEY is placeholder", () => {
    const env = {
      ...realEnv,
      STRAVA_TOKEN_KEYS: "",
      STRAVA_TOKEN_KEY: _internals.PLACEHOLDER_TOKEN_KEY,
    };
    expect(() => buildConfig(env as unknown as NodeJS.ProcessEnv)).toThrowError(
      /STRAVA_TOKEN/,
    );
  });

  it("production rejects empty CRON_SECRET", () => {
    const env = { ...realEnv, CRON_SECRET: "" };
    expect(() => buildConfig(env as unknown as NodeJS.ProcessEnv)).toThrowError(/CRON_SECRET/);
  });

  it("production rejects too-short CRON_SECRET", () => {
    const env = { ...realEnv, CRON_SECRET: "too-short" };
    expect(() => buildConfig(env as unknown as NodeJS.ProcessEnv)).toThrowError(
      /CRON_SECRET.*32/,
    );
  });

  it("production rejects empty TRUSTED_HOSTS", () => {
    const env = { ...realEnv, TRUSTED_HOSTS: "" };
    expect(() => buildConfig(env as unknown as NodeJS.ProcessEnv)).toThrowError(
      /TRUSTED_HOSTS/,
    );
  });

  it("staging is treated identically to production", () => {
    const env = { ...realEnv, APP_ENV: "staging", CRON_SECRET: "" };
    expect(() => buildConfig(env as unknown as NodeJS.ProcessEnv)).toThrowError(ConfigError);
  });

  it("production with all real values succeeds", () => {
    const cfg = buildConfig(realEnv as unknown as NodeJS.ProcessEnv);
    expect(cfg.appEnv).toBe("production");
    expect(cfg.trustedHosts).toEqual(["api.example.com"]);
    expect(cfg.corsOrigins).toEqual(["https://example.com"]);
  });

  it("CORS origins are split + trimmed + filtered", () => {
    const env = { ...realEnv, CORS_ORIGINS: "https://a.com, https://b.com ,, " };
    const cfg = buildConfig(env as unknown as NodeJS.ProcessEnv);
    expect(cfg.corsOrigins).toEqual(["https://a.com", "https://b.com"]);
  });

  it("trusted hosts are split + trimmed + filtered", () => {
    const env = { ...realEnv, TRUSTED_HOSTS: "a.com,b.com, " };
    const cfg = buildConfig(env as unknown as NodeJS.ProcessEnv);
    expect(cfg.trustedHosts).toEqual(["a.com", "b.com"]);
  });
});
