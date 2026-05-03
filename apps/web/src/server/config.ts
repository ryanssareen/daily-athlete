/**
 * Server-side configuration.
 *
 * Reads from process.env, validates with Zod, refuses to boot in non-development
 * environments when secrets are still placeholders or empty. Mirrors and extends
 * the Python Settings._validate_secrets_for_env that landed during ce:review for
 * the Wave-1 backend.
 */
import { z } from "zod";

const _PLACEHOLDER_SERVICE_KEY = "replace-with-supabase-service-role-key";
const _PLACEHOLDER_TOKEN_KEY = "replace-with-32-byte-random-key";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const AppEnvSchema = z.enum(["development", "test", "staging", "production"]);

const RawSchema = z.object({
  APP_ENV: AppEnvSchema.default("development"),
  LOG_LEVEL: z.string().default("info"),

  // Supabase. Accept empty values here; downstream validator decides whether
  // non-dev environments require them.
  SUPABASE_URL: z.string().default(""),
  SUPABASE_ANON_KEY: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),

  SUPABASE_JWT_JWKS_URL: z.string().default(""),
  SUPABASE_JWT_ISSUER: z.string().default(""),
  SUPABASE_JWT_AUD: z.string().default("authenticated"),

  // Strava token encryption
  STRAVA_TOKEN_KEYS: z.string().default(""),
  STRAVA_TOKEN_KEY: z.string().default(""),

  // Cron
  CRON_SECRET: z.string().default(""),

  // Network posture
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:8081"),
  TRUSTED_HOSTS: z.string().default(""),

  // Test database (used by Vitest harness only)
  DATABASE_URL_TEST_SYNC: z
    .string()
    .default("postgresql://postgres:postgres@localhost:54322/da2_test"),
});

export type AppEnv = z.infer<typeof AppEnvSchema>;

export interface Config {
  appEnv: AppEnv;
  logLevel: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  supabaseJwtJwksUrl: string;
  supabaseJwtIssuer: string;
  supabaseJwtAud: string;
  stravaTokenKeys: string;
  stravaTokenKey: string;
  cronSecret: string;
  corsOrigins: string[];
  trustedHosts: string[];
  databaseUrlTestSync: string;
}

function buildConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = RawSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid environment configuration: ${parsed.error.message}`);
  }
  const raw = parsed.data;

  // Derive the JWKS URL from SUPABASE_URL if not explicitly set.
  const derivedJwksUrl =
    raw.SUPABASE_JWT_JWKS_URL ||
    (raw.SUPABASE_URL ? `${raw.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json` : "");

  const cfg: Config = {
    appEnv: raw.APP_ENV,
    logLevel: raw.LOG_LEVEL,
    supabaseUrl: raw.SUPABASE_URL,
    supabaseAnonKey: raw.SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: raw.SUPABASE_SERVICE_ROLE_KEY,
    supabaseJwtJwksUrl: derivedJwksUrl,
    supabaseJwtIssuer: raw.SUPABASE_JWT_ISSUER,
    supabaseJwtAud: raw.SUPABASE_JWT_AUD,
    stravaTokenKeys: raw.STRAVA_TOKEN_KEYS,
    stravaTokenKey: raw.STRAVA_TOKEN_KEY,
    cronSecret: raw.CRON_SECRET,
    corsOrigins: raw.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    trustedHosts: raw.TRUSTED_HOSTS.split(",").map((s) => s.trim()).filter(Boolean),
    databaseUrlTestSync: raw.DATABASE_URL_TEST_SYNC,
  };

  validateForEnv(cfg);
  return cfg;
}

function validateForEnv(cfg: Config): void {
  if (cfg.appEnv !== "staging" && cfg.appEnv !== "production") {
    return;
  }

  const errors: string[] = [];

  if (!cfg.supabaseJwtJwksUrl) {
    errors.push("SUPABASE_JWT_JWKS_URL must be set (or SUPABASE_URL must be set so it can be derived)");
  }
  if (!cfg.supabaseJwtIssuer) {
    errors.push("SUPABASE_JWT_ISSUER must be set to defend against cross-project JWT replay");
  }
  if (
    !cfg.supabaseServiceRoleKey ||
    cfg.supabaseServiceRoleKey === _PLACEHOLDER_SERVICE_KEY
  ) {
    errors.push("SUPABASE_SERVICE_ROLE_KEY must be set to a real value");
  }
  if (
    (!cfg.stravaTokenKeys && (!cfg.stravaTokenKey || cfg.stravaTokenKey === _PLACEHOLDER_TOKEN_KEY))
  ) {
    errors.push("STRAVA_TOKEN_KEYS or STRAVA_TOKEN_KEY must be set to real value(s)");
  }
  if (!cfg.cronSecret) {
    errors.push("CRON_SECRET must be set");
  } else if (cfg.cronSecret.length < 32) {
    errors.push("CRON_SECRET must be at least 32 characters (use `openssl rand -base64 32`)");
  }
  if (cfg.trustedHosts.length === 0) {
    errors.push("TRUSTED_HOSTS must be set to defend against host-header attacks");
  }

  if (errors.length > 0) {
    throw new ConfigError(
      `Configuration unsafe for app_env=${cfg.appEnv}:\n  - ` + errors.join("\n  - "),
    );
  }
}

let _cached: Config | undefined;

export function getConfig(): Config {
  if (!_cached) _cached = buildConfig();
  return _cached;
}

/** Test helper: rebuild from a custom env. Resets the cache. */
export function resetConfigCache(): void {
  _cached = undefined;
}

export const _internals = {
  buildConfig,
  validateForEnv,
  PLACEHOLDER_SERVICE_KEY: _PLACEHOLDER_SERVICE_KEY,
  PLACEHOLDER_TOKEN_KEY: _PLACEHOLDER_TOKEN_KEY,
};
