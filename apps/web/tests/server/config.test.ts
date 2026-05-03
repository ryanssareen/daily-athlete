import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError, _internals } from "@/server/config";

const { buildConfig } = _internals;

type EnvOverrides = Record<string, string | undefined>;

/**
 * Test-friendly env factory. The default has all production-required values
 * filled with real-looking strings; tests override specific fields. Returning
 * the bare object means callers don't need any TS casts — `buildConfig` accepts
 * `Record<string, string | undefined>`.
 */
function envFixture(overrides: EnvOverrides = {}): Record<string, string | undefined> {
  return {
    APP_ENV: "production",
    SUPABASE_URL: "https://example-project.supabase.co",
    SUPABASE_ANON_KEY: "anon-key-real-value",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-real-value",
    SUPABASE_JWT_ISSUER: "https://example-project.supabase.co/auth/v1",
    STRAVA_TOKEN_KEYS: "1:" + "a".repeat(40),
    CRON_SECRET: "x".repeat(40),
    TRUSTED_HOSTS: "api.example.com",
    CORS_ORIGINS: "https://example.com",
    ...overrides,
  };
}

describe("config validation", () => {
  let snapshot: typeof process.env;
  beforeEach(() => {
    snapshot = { ...process.env };
  });
  afterEach(() => {
    process.env = snapshot;
  });

  it("development accepts placeholders / empty server-only values", () => {
    expect(() => buildConfig({ APP_ENV: "development" })).not.toThrow();
  });

  it("test env also skips the production guard", () => {
    expect(() => buildConfig({ APP_ENV: "test" })).not.toThrow();
  });

  it("production rejects empty SUPABASE_JWT_JWKS_URL when SUPABASE_URL is also unset", () => {
    expect(() =>
      buildConfig(envFixture({ SUPABASE_URL: "", SUPABASE_JWT_JWKS_URL: "" })),
    ).toThrowError(/SUPABASE_JWT_JWKS_URL/);
  });

  it("production derives SUPABASE_JWT_JWKS_URL from SUPABASE_URL when not set", () => {
    const cfg = buildConfig(envFixture());
    expect(cfg.supabaseJwtJwksUrl).toBe(
      "https://example-project.supabase.co/auth/v1/.well-known/jwks.json",
    );
  });

  it("production rejects http:// JWKS URLs", () => {
    expect(() =>
      buildConfig(
        envFixture({
          SUPABASE_JWT_JWKS_URL: "http://example-project.supabase.co/auth/v1/.well-known/jwks.json",
        }),
      ),
    ).toThrowError(/https/);
  });

  it("production rejects JWKS URL whose origin doesn't match SUPABASE_URL", () => {
    expect(() =>
      buildConfig(
        envFixture({
          SUPABASE_JWT_JWKS_URL: "https://attacker.example.com/auth/v1/.well-known/jwks.json",
        }),
      ),
    ).toThrowError(/origin.*must match/);
  });

  it("production rejects malformed JWKS URL", () => {
    expect(() =>
      buildConfig(envFixture({ SUPABASE_JWT_JWKS_URL: "not-a-url" })),
    ).toThrowError(/SUPABASE_JWT_JWKS_URL/);
  });

  it("production rejects empty SUPABASE_JWT_ISSUER", () => {
    expect(() => buildConfig(envFixture({ SUPABASE_JWT_ISSUER: "" }))).toThrowError(
      /SUPABASE_JWT_ISSUER/,
    );
  });

  it("production rejects placeholder SUPABASE_SERVICE_ROLE_KEY", () => {
    expect(() =>
      buildConfig(
        envFixture({ SUPABASE_SERVICE_ROLE_KEY: _internals.PLACEHOLDER_SERVICE_KEY }),
      ),
    ).toThrowError(/SERVICE_ROLE_KEY/);
  });

  it("production rejects empty STRAVA_TOKEN_KEYS when STRAVA_TOKEN_KEY is placeholder", () => {
    expect(() =>
      buildConfig(
        envFixture({
          STRAVA_TOKEN_KEYS: "",
          STRAVA_TOKEN_KEY: _internals.PLACEHOLDER_TOKEN_KEY,
        }),
      ),
    ).toThrowError(/STRAVA_TOKEN/);
  });

  it("production rejects empty CRON_SECRET", () => {
    expect(() => buildConfig(envFixture({ CRON_SECRET: "" }))).toThrowError(
      /CRON_SECRET/,
    );
  });

  it("production rejects too-short CRON_SECRET", () => {
    expect(() => buildConfig(envFixture({ CRON_SECRET: "too-short" }))).toThrowError(
      /CRON_SECRET.*32/,
    );
  });

  it("production rejects empty TRUSTED_HOSTS", () => {
    expect(() => buildConfig(envFixture({ TRUSTED_HOSTS: "" }))).toThrowError(
      /TRUSTED_HOSTS/,
    );
  });

  it("staging is treated identically to production (same fields are validated)", () => {
    expect(() =>
      buildConfig(envFixture({ APP_ENV: "staging", CRON_SECRET: "" })),
    ).toThrowError(/CRON_SECRET/);
  });

  it("production with all real values succeeds", () => {
    const cfg = buildConfig(envFixture());
    expect(cfg.appEnv).toBe("production");
    expect(cfg.trustedHosts).toEqual(["api.example.com"]);
    expect(cfg.corsOrigins).toEqual(["https://example.com"]);
  });

  it("CORS origins are split + trimmed + filtered", () => {
    const cfg = buildConfig(envFixture({ CORS_ORIGINS: "https://a.com, https://b.com ,, " }));
    expect(cfg.corsOrigins).toEqual(["https://a.com", "https://b.com"]);
  });

  it("trusted hosts are split + trimmed + filtered", () => {
    const cfg = buildConfig(envFixture({ TRUSTED_HOSTS: "a.com,b.com, " }));
    expect(cfg.trustedHosts).toEqual(["a.com", "b.com"]);
  });

  it("ConfigError preserves Zod cause when shape parsing fails", () => {
    let caught: unknown;
    try {
      buildConfig({ APP_ENV: "not-a-real-env" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as Error).cause).toBeDefined();
    expect((caught as Error).message).toMatch(/APP_ENV/);
  });
});
