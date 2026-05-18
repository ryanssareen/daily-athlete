// Boot-time env validator. Refuses to construct a config object in
// production when required secrets are missing or contain placeholder
// values ('', 'xxx', 'hex', all-zeros for hex-keys). In dev/test, missing
// optional secrets warn but boot proceeds so unrelated subsystems aren't
// blocked.
//
// AGENTS.md "Secrets" anchors this contract: every new sensitive setting
// that joins the env surface must extend this validator.
//
// Two exports:
// - `loadConfig()`: explicit, memoised; preferred when callers want a
//   reference they can pass around.
// - `config`: eager singleton evaluated at module import. Importing this
//   from a route handler or worker fails fast at boot if env is invalid,
//   which is what we want in production.

import { z } from "zod";

const PLACEHOLDERS = new Set(["", "xxx", "hex"]);

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
  STRAVA_WEBHOOK_SUBSCRIPTION_ID?: string;
  STRAVA_OAUTH_STATE_SIGNING_KEY?: string;
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
    webhookSubscriptionId: number | undefined;
    stateSigningKey: string | undefined;
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

function validateStateSigningKeyProd(v: Validator): void {
  // 32-byte HMAC-SHA256 key for the Strava OAuth state nonce
  // (apps/web/src/strava/state-nonce.ts). Format: 64 hex chars (= 32
  // bytes). The /init route refuses to sign and /connect refuses to
  // verify when this is missing; in production that's a hard fail.
  const raw = v.raw.STRAVA_OAUTH_STATE_SIGNING_KEY;
  if (!raw) {
    v.errors.push(
      "STRAVA_OAUTH_STATE_SIGNING_KEY is required in production"
    );
    return;
  }
  if (isPlaceholder(raw)) {
    v.errors.push(
      "STRAVA_OAUTH_STATE_SIGNING_KEY contains placeholder value"
    );
    return;
  }
  if (isAllZeroHex(raw)) {
    v.errors.push(
      "STRAVA_OAUTH_STATE_SIGNING_KEY is all-zero (placeholder)"
    );
    return;
  }
  if (!/^[0-9a-fA-F]+$/.test(raw)) {
    v.errors.push(
      "STRAVA_OAUTH_STATE_SIGNING_KEY contains non-hex characters"
    );
    return;
  }
  if (raw.length !== 64) {
    v.errors.push(
      `STRAVA_OAUTH_STATE_SIGNING_KEY must be 64 hex chars (32 bytes); got ${raw.length}`
    );
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
  // Format is `version:hex,...`. The full parser lives in
  // security/token-crypto.ts; this validator keeps the same shape rules so
  // a config that boots also passes token-crypto's stricter check on first
  // use (no divergent-validators surprise).
  const entries = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) {
    v.errors.push("STRAVA_TOKEN_KEYS parsed to zero entries");
    return;
  }
  const seenVersions = new Set<number>();
  for (const entry of entries) {
    const colon = entry.indexOf(":");
    if (colon === -1) {
      v.errors.push(
        `STRAVA_TOKEN_KEYS entry "${entry}" missing "version:hex" prefix`
      );
      continue;
    }
    const versionRaw = entry.slice(0, colon);
    const version = Number(versionRaw);
    if (!Number.isInteger(version) || version < 1) {
      v.errors.push(
        `STRAVA_TOKEN_KEYS version "${versionRaw}" must be a positive integer`
      );
      continue;
    }
    if (seenVersions.has(version)) {
      v.errors.push(`STRAVA_TOKEN_KEYS contains duplicate version ${version}`);
      continue;
    }
    seenVersions.add(version);

    const hex = entry.slice(colon + 1);
    if (isAllZeroHex(hex)) {
      v.errors.push(
        `STRAVA_TOKEN_KEYS version ${version} is all-zero (placeholder)`
      );
      continue;
    }
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      v.errors.push(
        `STRAVA_TOKEN_KEYS hex value for version ${version} contains non-hex characters`
      );
      continue;
    }
    if (hex.length !== 64) {
      v.errors.push(
        `STRAVA_TOKEN_KEYS hex value for version ${version} must be 64 hex chars (32 bytes); got ${hex.length}`
      );
    }
  }
}

function validateWebhookSubscriptionIdProd(v: Validator): void {
  const raw = v.raw.STRAVA_WEBHOOK_SUBSCRIPTION_ID;
  if (!raw || isPlaceholder(raw)) {
    v.errors.push(
      "STRAVA_WEBHOOK_SUBSCRIPTION_ID is required in production (env: STRAVA_WEBHOOK_SUBSCRIPTION_ID)"
    );
    return;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    v.errors.push(
      "STRAVA_WEBHOOK_SUBSCRIPTION_ID must be a positive integer — Number(undefined) = NaN silently discards all webhook events"
    );
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
    validateWebhookSubscriptionIdProd(v);
    validateStravaTokenKeysProd(v);
    validateStateSigningKeyProd(v);
    // Inngest keys are optional — backfill runs via Next.js after() + Vercel
    // cron. The /api/inngest route still exists for future use; warn so any
    // accidental production misconfiguration surfaces in deploy logs.
    if (!raw.INNGEST_EVENT_KEY) {
      v.warnings.push("INNGEST_EVENT_KEY missing in production");
    }
    if (!raw.INNGEST_SIGNING_KEY) {
      v.warnings.push("INNGEST_SIGNING_KEY missing in production");
    }
  } else {
    if (!raw.NEXT_PUBLIC_SUPABASE_URL) {
      v.warnings.push(
        "NEXT_PUBLIC_SUPABASE_URL missing (dev/test) -- supabase calls will fail"
      );
    }
    if (!raw.STRAVA_OAUTH_STATE_SIGNING_KEY) {
      v.warnings.push(
        "STRAVA_OAUTH_STATE_SIGNING_KEY missing (dev/test) -- /api/integrations/strava/init will reject"
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
      webhookSubscriptionId: raw.STRAVA_WEBHOOK_SUBSCRIPTION_ID
        ? Number(raw.STRAVA_WEBHOOK_SUBSCRIPTION_ID)
        : undefined,
      stateSigningKey: raw.STRAVA_OAUTH_STATE_SIGNING_KEY,
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

// Lazy singleton via Proxy. Callers write `import { config } from "@/config"`
// and access properties normally (`config.strava.clientId`); each top-level
// property read invokes `loadConfig()` once and caches.
//
// Why a Proxy instead of an eager `const config = loadConfig()`:
// Next.js's build phase evaluates module-top-level expressions to bundle
// route handlers. An eager call to `loadConfig()` runs the production
// validator at BUILD time -- on Vercel, in CI, anywhere the bundler runs --
// not just at request time. Build environments don't have the real secrets
// (and shouldn't), so validation has to defer to first access, not first
// import. The Proxy keeps the ergonomic `config.x.y` shape while moving
// validation to the call site, where the secret actually matters.
//
// Tests that explicitly exercise boot-time behavior still call
// `loadConfig()` directly via the named export.
export const config: AppConfig = new Proxy({} as AppConfig, {
  get(_target, prop, receiver) {
    return Reflect.get(loadConfig(), prop, receiver);
  },
});
