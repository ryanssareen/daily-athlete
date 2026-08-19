// The shared LLM client boundary.
//
// Two consumers depend on THIS interface, not on the Anthropic SDK:
//   - the plan generator (apps/web/src/ai/generation) calls generateStructured
//     directly and validates the result against GeneratedPlanSchema;
//   - the adaptive proposer (apps/web/src/ai/adaptive/llm-proposer, Unit 6)
//     implements AdaptiveProposer over this client.
//
// The interface input is provider-neutral (`system` + `prompt`, not the SDK's
// `messages` shape) so a future OpenAI adapter drops in without touching
// callers. Only an Anthropic adapter is implemented in v1.
//
// TRUST BOUNDARY: generateStructured returns RAW parsed JSON (`unknown`). It
// never Zod-validates a domain schema — that is the caller's job. The optional
// `schema` is passed to the provider as a soft structured-output hint to reduce
// malformed output, never as the trust boundary.

import type { ZodTypeAny } from "zod";

import { config } from "@/config";

import { AnthropicClient } from "./anthropic";
import { GroqClient } from "./groq";

export {
  LlmError,
  LlmRateLimited,
  LlmTransient,
  LlmInvalidOutput,
  isLlmBackOff,
} from "./errors";
export type { LlmErrorCode } from "./errors";

/** Token + latency accounting returned alongside every call (provider-neutral). */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface GenerateStructuredParams {
  /** System prompt (instructions). Athlete free-text must be delimited as data,
   * never placed in this instruction region. */
  system: string;
  /** The user turn — the data + ask. */
  prompt: string;
  /** Optional Zod schema, used only as a soft provider-side hint. The caller
   * still safeParses the returned JSON. */
  schema?: ZodTypeAny;
  /** Trace label for observability (Langfuse span name). */
  traceName: string;
  /** Abort signal; the adapter also applies its own timeout. */
  signal?: AbortSignal;
  /**
   * Per-call cap on generated tokens, overriding the adapter default.
   *
   * This is a BUDGET control, not just a truncation guard. Groq bills
   * `max_completion_tokens` against the per-minute token allowance UP FRONT,
   * before a single token is generated — so a caller that asks for the
   * plan-sized default to produce a four-sentence note is rejected outright
   * with `rate_limit_exceeded` ("Request too large"), never gets its answer,
   * and consumes the whole minute's budget on this tier. Callers whose output
   * is schema-capped small should say so here.
   */
  maxTokens?: number;
}

export interface LlmResult {
  /** Raw parsed JSON from the model. The caller validates it. */
  json: unknown;
  usage: LlmUsage;
}

export interface LlmClient {
  generateStructured(params: GenerateStructuredParams): Promise<LlmResult>;
}

// Per-provider model defaults, overridable via LLM_MODEL (tuned through the
// eval harness). These live here — not in config — so config stays a plain
// env mirror and provider selection owns its own fallbacks.
const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8";
// Groq retired `llama-3.3-70b-versatile`; it now 404s `model_not_found` for
// keys that used to serve it, which silently broke every LLM feature in
// production. Keep this pointed at a model the account can actually reach and
// re-check it when Groq rotates their catalogue.
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/**
 * Construct the configured LLM client. Mirrors createAdminClient(): reads
 * `config`, throws a clear error if no key is set — so a missing key fails
 * the generation CALL (which is entitlement-gated and rare), not app boot.
 *
 * Provider selection: LLM_PROVIDER pins explicitly; otherwise the provider
 * whose key is present is used, Anthropic winning when both are set.
 */
export function createLlmClient(): LlmClient {
  const { anthropicApiKey, groqApiKey, provider, model } = config.llm;
  const resolved =
    provider ?? (anthropicApiKey ? "anthropic" : groqApiKey ? "groq" : undefined);

  if (resolved === "anthropic" && anthropicApiKey) {
    return new AnthropicClient({
      apiKey: anthropicApiKey,
      model: model ?? DEFAULT_ANTHROPIC_MODEL,
    });
  }
  if (resolved === "groq" && groqApiKey) {
    return new GroqClient({
      apiKey: groqApiKey,
      model: model ?? DEFAULT_GROQ_MODEL,
    });
  }
  // DEBUG (diagnose "generation always fails no matter what"): this throw is the
  // actual prod failure today — an EMPTY GROQ_API_KEY is normalized to undefined
  // by config (isPlaceholder("") === true), so no provider resolves and every
  // generation dies here, then gets retried + flattened into an opaque
  // "generation_failed". Log WHICH knobs are present (booleans only, never key
  // values) so a misconfigured env is obvious in Vercel logs.
  console.error(
    "[llm][debug] createLlmClient: no provider configured — AI generation will fail",
    JSON.stringify({
      hasAnthropicKey: Boolean(anthropicApiKey),
      hasGroqKey: Boolean(groqApiKey),
      providerPin: provider ?? null,
      modelOverride: model ?? null,
    })
  );
  throw new Error(
    "No LLM provider configured. AI plan generation and adaptive re-planning " +
      "require ANTHROPIC_API_KEY or GROQ_API_KEY (LLM_PROVIDER pins the choice " +
      "when both are set). Set one in the environment to enable these features."
  );
}
