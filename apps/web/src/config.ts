// Boot-time env validator. Refuses to construct a config object in
// production when required secrets are missing or contain placeholder
// values ('', 'xxx', 'hex', all-zeros for hex-keys). In dev/test, missing
// optional secrets warn but boot proceeds so unrelated subsystems aren't
// blocked.
//
// AGENTS.md "Secrets" anchors this contract: every new sensitive setting
// that joins the env surface must extend this validator.
//
// Convention: callers import { config } for the validated object. The
// loadConfig() function is exported for tests; production code reads the
// memoised `config` re-export below.

import { z } from "zod";

const PLACEHOLDERS = new Set(["", "xxx", "hex"]);
const ZERO_HEX_64 = "0".repeat(64);

function isPlaceholder(value: string): boolean {
  return PLACEHOLDERS.has(value.trim());
}

function isAllZeroHex(value: string): boolean {
  return /^0+$/.test(value) && value.length >= 8;
}

const NodeEnvSchema = z.enum(["development", "test", "production"]);

interface RawEnv {
  NODE_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
  STRAVA_TOKEN_KEYS?: string;
  STRAVA_WEBHOOK_VERIFY_TOKEN?: string;
  INNGEST_EVENT_KEY?: string;
  INNGEST_SIGNING_KEY?: string;
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  supabase: {
    url: string | undefined;
    anonKey: string | undefined;
    serviceRoleKey: string | undefined;
  };
  strava: {
    clientId: string | undefined;
    clientSecret: string | undefined;
    tokenKeysRaw: string | undefined;
    webhookVerifyToken: string | undefined;
  };
  inngest: {
    eventKey: string | undefined;
    signingKey: string | undefined;
  };
}

let cached: AppConfig | null = null;

function readNodeEnv(raw: RawEnv): "development" | "test" | "production" {
  const parsed = NodeEnvSchema.safeParse(raw.NODE_ENV ?? "development");
  return parsed.success ? parsed.data : "development";
}

interface Validator {
  errors: string[];
  warnings: string[];
  isProd: boolean;
  raw: RawEnv;
}

function requireProd(v: Validator, key: keyof RawEnv, label: string): void {
  const value = v.raw[key];
  if (value === undefined || value === "") {
    v.errors.push(`${label} is required in production (env: ${key})`);
    return;
  }
  if (isPlaceholder(value)) {
    v.errors.push(`${label} contains placeholder value (env: ${key})`);
  }
}

function validateStravaTokenKeysProd(v: Validator): void {
  const raw = v.raw.STRAVA_TOKEN_KEYS;
  if (!raw) {
    v.errors.push("STRAVA_TOKEN_KEYS is required in production");
    return;
  }
  if (isPlaceholder(raw)) {
    v.errors.push("STRAVA_TOKEN_KEYS contains placeholder value");
    return;
  }
  // Format is `version:hex,...`. We validate each entry without duplicating
  // the full parser in security/token-crypto.ts -- this is a cheap surface
  // check so production refuses to boot on obvious misconfig before any
  // first-real-use error surfaces.
  const entries = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) {
    v.errors.push("STRAVA_TOKEN_KEYS parsed to zero entries");
    return;
  }
  for (const entry of entries) {
    const colon = entry.indexOf(":");
    if (colon === -1) {
      v.errors.push(
        `STRAVA_TOKEN_KEYS entry "${entry}" missing "version:hex" prefix`
      );
      continue;
    }
    const hex = entry.slice(colon + 1);
    if (hex === ZERO_HEX_64 || isAllZeroHex(hex)) {
      v.errors.push("STRAVA_TOKEN_KEYS contains an all-zero (placeholder) key");
      continue;
    }
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      v.errors.push(
        `STRAVA_TOKEN_KEYS hex value for version "${entry.slice(0, colon)}" contains non-hex characters`
      );
      continue;
    }
    if (hex.length !== 64) {
      v.errors.push(
        `STRAVA_TOKEN_KEYS hex value for version "${entry.slice(0, colon)}" must be 64 hex chars (32 bytes); got ${hex.length}`
      );
    }
  }
}

function buildFromRaw(raw: RawEnv): AppConfig {
  const nodeEnv = readNodeEnv(raw);
  const isProd = nodeEnv === "production";
  const v: Validator = { errors: [], warnings: [], isProd, raw };

  if (isProd) {
    requireProd(v, "NEXT_PUBLIC_SUPABASE_URL", "Supabase URL");
    requireProd(v, "NEXT_PUBLIC_SUPABASE_ANON_KEY", "Supabase anon key");
    requireProd(v, "SUPABASE_SERVICE_ROLE_KEY", "Supabase service-role key");
    requireProd(v, "STRAVA_CLIENT_ID", "Strava client id");
    requireProd(v, "STRAVA_CLIENT_SECRET", "Strava client secret");
    requireProd(
      v,
      "STRAVA_WEBHOOK_VERIFY_TOKEN",
      "Strava webhook verify token"
    );
    validateStravaTokenKeysProd(v);
    // Inngest event/signing keys aren't fatal at boot -- if they're missing
    // in production, Inngest itself surfaces the misconfig on first event
    // dispatch with a clearer, library-side message.
    if (!raw.INNGEST_EVENT_KEY) {
      v.warnings.push("INNGEST_EVENT_KEY missing in production");
    }
  } else {
    if (!raw.NEXT_PUBLIC_SUPABASE_URL) {
      v.warnings.push(
        "NEXT_PUBLIC_SUPABASE_URL missing (dev/test) -- supabase calls will fail"
      );
    }
  }

  if (v.errors.length > 0) {
    throw new Error(
      `apps/web boot config invalid:\n - ${v.errors.join("\n - ")}`
    );
  }
  for (const w of v.warnings) {
    // eslint-disable-next-line no-console
    console.warn(`[config] ${w}`);
  }

  return {
    nodeEnv,
    supabase: {
      url: raw.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: raw.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      serviceRoleKey: raw.SUPABASE_SERVICE_ROLE_KEY,
    },
    strava: {
      clientId: raw.STRAVA_CLIENT_ID,
      clientSecret: raw.STRAVA_CLIENT_SECRET,
      tokenKeysRaw: raw.STRAVA_TOKEN_KEYS,
      webhookVerifyToken: raw.STRAVA_WEBHOOK_VERIFY_TOKEN,
    },
    inngest: {
      eventKey: raw.INNGEST_EVENT_KEY,
      signingKey: raw.INNGEST_SIGNING_KEY,
    },
  };
}

export function loadConfig(): AppConfig {
  if (cached) return cached;
  cached = buildFromRaw(process.env as RawEnv);
  return cached;
}

export function __resetConfigCacheForTests(): void {
  cached = null;
}
