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
}

export interface LlmResult {
  /** Raw parsed JSON from the model. The caller validates it. */
  json: unknown;
  usage: LlmUsage;
}

export interface LlmClient {
  generateStructured(params: GenerateStructuredParams): Promise<LlmResult>;
}

/**
 * Construct the configured LLM client. Mirrors createAdminClient(): reads
 * `config`, throws a clear error if the key is missing — so a missing key fails
 * the generation CALL (which is entitlement-gated and rare), not app boot.
 */
export function createLlmClient(): LlmClient {
  const apiKey = config.llm.anthropicApiKey;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not configured. AI plan generation and adaptive " +
        "re-planning require it. Set it in the environment to enable these features."
    );
  }
  return new AnthropicClient({ apiKey, model: config.llm.model });
}
