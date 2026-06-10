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
  ANTHROPIC_API_KEY?: string;
  GROQ_API_KEY?: string;
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  LANGFUSE_HOST?: string;
  ADMIN_SECRET?: string;
  ADMIN_SESSION_SIGNING_KEY?: string;
  SUPABASE_MANAGEMENT_TOKEN?: string;
  SUPABASE_PROJECT_REF?: string;
  BACKUP_ENCRYPTION_KEYS?: string;
  ADMIN_BACKUP_BUCKET?: string;
  BREVO_API_KEY?: string;
  EMAIL_SENDER?: string;
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
  llm: {
    // Provider API keys for AI plan generation + adaptive re-planning. Both
    // optional in config (WARN, not fatal, in prod): missing keys disable the
    // AI features but must not brick the app. createLlmClient() throws at the
    // call site when none is set. The generation/adaptive paths are
    // entitlement-gated, so a missing key surfaces only there.
    anthropicApiKey: string | undefined;
    groqApiKey: string | undefined;
    // Explicit provider pin ("anthropic" | "groq"). Undefined = auto: the
    // provider whose key is set, Anthropic winning when both are.
    provider: "anthropic" | "groq" | undefined;
    // Model id override, tunable via the eval harness. Undefined = each
    // adapter's default (createLlmClient owns the per-provider defaults).
    model: string | undefined;
  };
  langfuse: {
    // LLM observability (apps/web/src/llm/tracing.ts). All optional and WARN,
    // never fatal: tracing is best-effort and PII-minimized (metadata only).
    publicKey: string | undefined;
    secretKey: string | undefined;
    host: string | undefined;
  };
  admin: {
    password: string | undefined;
    sessionSigningKey: string | undefined;
    // Optional: enables the managed-backup status panel (read-only Management
    // API). Absent => the panel renders an "unconfigured" note, not an error.
    managementToken: string | undefined;
    projectRef: string | undefined;
  };
  backups: {
    // AES-256-GCM versioned keys for the on-demand export artifact. Format:
    // `1:<64-hex>,2:<64-hex>,...` (same shape as STRAVA_TOKEN_KEYS).
    encryptionKeysRaw: string | undefined;
    bucket: string;
  };
  email: {
    // Brevo transactional email for admin moderation reason emails
    // (apps/web/src/email/brevo.ts). Both optional: when absent, emails are
    // disabled (notifyModeration returns sent:false) and the moderation action
    // still succeeds.
    brevoApiKey: string | undefined;
    sender: string | undefined;
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
  // Demoted from fatal to warning: the webhook route at
  // app/api/integrations/strava/webhook/route.ts already fails safe when
  // the value is undefined (returns { ok: true } without processing), so
  // a missing env var should NOT crash the whole app at boot. The right
  // failure mode is "webhook is a no-op until the var is set," not
  // "every server-rendered page returns 500."
  const raw = v.raw.STRAVA_WEBHOOK_SUBSCRIPTION_ID;
  if (!raw || isPlaceholder(raw)) {
    v.warnings.push(
      "STRAVA_WEBHOOK_SUBSCRIPTION_ID missing — Strava webhook events will be ignored until set"
    );
    return;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    // A non-numeric value is still a hard error — silently coercing to
    // NaN would make every event match comparison return false and lose
    // data without surfacing why.
    v.errors.push(
      "STRAVA_WEBHOOK_SUBSCRIPTION_ID must be a positive integer when set (Number(\"bad\") = NaN silently discards all webhook events)"
    );
  }
}

function validateAdminSecretProd(v: Validator): void {
  const raw = v.raw.ADMIN_SECRET;
  if (!raw) {
    v.errors.push("ADMIN_SECRET is required in production");
    return;
  }
  if (isPlaceholder(raw)) {
    v.errors.push("ADMIN_SECRET contains placeholder value");
    return;
  }
}

function validateAdminSessionSigningKeyProd(v: Validator): void {
  // 32-byte HMAC-SHA256 key for the admin session cookie
  // (apps/web/src/auth/admin-session.ts). Format: 64 hex chars (= 32 bytes),
  // same shape as STRAVA_OAUTH_STATE_SIGNING_KEY.
  const raw = v.raw.ADMIN_SESSION_SIGNING_KEY;
  if (!raw) {
    v.errors.push("ADMIN_SESSION_SIGNING_KEY is required in production");
    return;
  }
  if (isPlaceholder(raw)) {
    v.errors.push("ADMIN_SESSION_SIGNING_KEY contains placeholder value");
    return;
  }
  if (isAllZeroHex(raw)) {
    v.errors.push("ADMIN_SESSION_SIGNING_KEY is all-zero (placeholder)");
    return;
  }
  if (!/^[0-9a-fA-F]+$/.test(raw)) {
    v.errors.push("ADMIN_SESSION_SIGNING_KEY contains non-hex characters");
    return;
  }
  if (raw.length !== 64) {
    v.errors.push(
      `ADMIN_SESSION_SIGNING_KEY must be 64 hex chars (32 bytes); got ${raw.length}`
    );
  }
}

function validateBackupEncryptionKeysProd(v: Validator): void {
  // Versioned AES-256-GCM keys for the export artifact. Fail-fast on
  // missing/placeholder/misshaped here; the authoritative strict parse (dup
  // versions etc.) lives in src/admin/backup-crypto.ts at first use.
  const raw = v.raw.BACKUP_ENCRYPTION_KEYS;
  if (!raw) {
    v.errors.push("BACKUP_ENCRYPTION_KEYS is required in production");
    return;
  }
  if (isPlaceholder(raw)) {
    v.errors.push("BACKUP_ENCRYPTION_KEYS contains placeholder value");
    return;
  }
  const entries = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) {
    v.errors.push("BACKUP_ENCRYPTION_KEYS parsed to zero entries");
    return;
  }
  for (const entry of entries) {
    if (!/^\d+:[0-9a-fA-F]{64}$/.test(entry)) {
      v.errors.push(
        `BACKUP_ENCRYPTION_KEYS entry "${entry}" must be "version:64-hex"`
      );
    } else if (isAllZeroHex(entry.slice(entry.indexOf(":") + 1))) {
      v.errors.push("BACKUP_ENCRYPTION_KEYS contains an all-zero (placeholder) key");
    }
  }
}

function validateBrevoProd(v: Validator): void {
  // Transactional email for admin moderation reason emails
  // (apps/web/src/email/brevo.ts). Intentionally WARN, not fatal: a missing key
  // must NOT brick boot — moderation still works, the email just doesn't send
  // (notifyModeration returns sent:false). Mirrors the
  // STRAVA_WEBHOOK_SUBSCRIPTION_ID fail-safe posture. Shape-check when present.
  const key = v.raw.BREVO_API_KEY;
  const sender = v.raw.EMAIL_SENDER;
  if (!key || isPlaceholder(key)) {
    v.warnings.push(
      "BREVO_API_KEY missing — admin moderation emails are disabled until set"
    );
    return;
  }
  if (!key.startsWith("xkeysib-")) {
    v.warnings.push(
      'BREVO_API_KEY does not look like a Brevo key (expected "xkeysib-" prefix) — sends may fail'
    );
  }
  if (!sender || isPlaceholder(sender)) {
    v.warnings.push(
      "EMAIL_SENDER missing while BREVO_API_KEY is set — moderation emails need a verified sender to send"
    );
  }
}

function validateInngestSigningKeyProd(v: Validator): void {
  // Inngest HMAC verification for the serve endpoint. The new AI generation
  // worker archives an athlete's active plan and spends model tokens, so an
  // unsigned endpoint is a forged-event surface — the key SHOULD be set in
  // prod. WARN (not fatal) deliberately: commit cd185b2 removed the hard
  // Inngest prod requirement to avoid bricking deploys (see PR #87), so this
  // nudges without reversing that decision. Mirrors the Brevo/webhook posture.
  const key = v.raw.INNGEST_SIGNING_KEY;
  if (!key || isPlaceholder(key)) {
    v.warnings.push(
      "INNGEST_SIGNING_KEY missing — the Inngest endpoint accepts unsigned events; set it in production so forged plan-generation events are rejected"
    );
  }
}

function validateLlmProd(v: Validator): void {
  // AI plan generation + adaptive re-planning (apps/web/src/llm). Intentionally
  // WARN, not fatal: missing keys disable the AI features (createLlmClient
  // throws at the entitlement-gated call site) but must NOT brick boot, the
  // same posture as BREVO_API_KEY. Shape-check keys when present.
  const anthropic = v.raw.ANTHROPIC_API_KEY;
  const groq = v.raw.GROQ_API_KEY;
  const hasAnthropic = Boolean(anthropic && !isPlaceholder(anthropic));
  const hasGroq = Boolean(groq && !isPlaceholder(groq));

  if (!hasAnthropic && !hasGroq) {
    v.warnings.push(
      "No LLM API key (ANTHROPIC_API_KEY or GROQ_API_KEY) — AI plan generation and adaptive re-planning are disabled until one is set"
    );
    return;
  }
  if (hasAnthropic && !anthropic!.startsWith("sk-ant-")) {
    v.warnings.push(
      'ANTHROPIC_API_KEY does not look like an Anthropic key (expected "sk-ant-" prefix) — calls may fail'
    );
  }
  if (hasGroq && !groq!.startsWith("gsk_")) {
    v.warnings.push(
      'GROQ_API_KEY does not look like a Groq key (expected "gsk_" prefix) — calls may fail'
    );
  }

  const provider = v.raw.LLM_PROVIDER;
  if (provider && provider !== "anthropic" && provider !== "groq") {
    v.warnings.push(
      `LLM_PROVIDER "${provider}" is not recognized (expected "anthropic" or "groq") — falling back to key-based auto-selection`
    );
  } else if (provider === "anthropic" && !hasAnthropic) {
    v.warnings.push(
      "LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing — AI calls will fail until set"
    );
  } else if (provider === "groq" && !hasGroq) {
    v.warnings.push(
      "LLM_PROVIDER=groq but GROQ_API_KEY is missing — AI calls will fail until set"
    );
  }
}

function validateLangfuseProd(v: Validator): void {
  // Best-effort LLM tracing (apps/web/src/llm/tracing.ts). All three vars are
  // needed to trace; any missing one disables tracing (no-op) without failing
  // generation. WARN only — observability is never allowed to brick boot.
  const { LANGFUSE_PUBLIC_KEY: pub, LANGFUSE_SECRET_KEY: sec, LANGFUSE_HOST: host } =
    v.raw;
  const some = pub || sec || host;
  const all = pub && sec && host;
  if (some && !all) {
    v.warnings.push(
      "LANGFUSE_* partially configured — all of LANGFUSE_PUBLIC_KEY/SECRET_KEY/HOST are required to trace; tracing disabled"
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
    validateAdminSecretProd(v);
    validateAdminSessionSigningKeyProd(v);
    validateBrevoProd(v);
    validateInngestSigningKeyProd(v);
    validateLlmProd(v);
    validateLangfuseProd(v);
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
    llm: {
      // Placeholder values ('', 'xxx', 'hex') are normalized to undefined so
      // createLlmClient's key-presence selection agrees with what
      // validateLlmProd warned about — a placeholder key must never reach a
      // provider call as a literal credential.
      anthropicApiKey:
        raw.ANTHROPIC_API_KEY && !isPlaceholder(raw.ANTHROPIC_API_KEY)
          ? raw.ANTHROPIC_API_KEY
          : undefined,
      groqApiKey:
        raw.GROQ_API_KEY && !isPlaceholder(raw.GROQ_API_KEY)
          ? raw.GROQ_API_KEY
          : undefined,
      provider:
        raw.LLM_PROVIDER === "anthropic" || raw.LLM_PROVIDER === "groq"
          ? raw.LLM_PROVIDER
          : undefined,
      model: raw.LLM_MODEL,
    },
    langfuse: {
      publicKey: raw.LANGFUSE_PUBLIC_KEY,
      secretKey: raw.LANGFUSE_SECRET_KEY,
      host: raw.LANGFUSE_HOST,
    },
    admin: {
      password: raw.ADMIN_SECRET,
      sessionSigningKey: raw.ADMIN_SESSION_SIGNING_KEY,
      managementToken: raw.SUPABASE_MANAGEMENT_TOKEN,
      projectRef: raw.SUPABASE_PROJECT_REF,
    },
    backups: {
      encryptionKeysRaw: raw.BACKUP_ENCRYPTION_KEYS,
      bucket: raw.ADMIN_BACKUP_BUCKET ?? "admin-backups",
    },
    email: {
      brevoApiKey: raw.BREVO_API_KEY,
      sender: raw.EMAIL_SENDER,
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
