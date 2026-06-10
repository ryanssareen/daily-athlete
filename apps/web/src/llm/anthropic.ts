// Anthropic (Claude) adapter for the shared LlmClient.
//
// Plain `fetch` against the Messages API — mirroring the repo's fail-soft
// fetch-wrapper idiom (apps/web/src/email/brevo.ts) rather than pulling in the
// SDK. This keeps the whole client MSW-testable and dependency-light. The SDK
// can replace the transport later behind the same LlmClient interface.
//
// Returns RAW parsed JSON (never validates a domain schema). Maps provider
// failures to typed Llm* errors and never logs the API key or raw provider
// body.

import {
  LlmInvalidOutput,
  LlmRateLimited,
  LlmTransient,
} from "./errors";
import type {
  GenerateStructuredParams,
  LlmClient,
  LlmResult,
  LlmUsage,
} from "./index";
import { emitTrace } from "./tracing";
import { appendSchemaHint, combineSignals, extractJson } from "./transport";

// Re-exported for existing consumers/tests; the implementation moved to
// transport.ts when the Groq adapter joined (provider-neutral helper).
export { extractJson } from "./transport";

const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const REQUEST_TIMEOUT_MS = 120_000; // bounded; the Inngest step deadline absorbs the rest
const DEFAULT_MAX_TOKENS = 8192;

interface AnthropicClientOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
  baseUrl?: string;
}

interface AnthropicMessageResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicClient implements LlmClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly baseUrl: string;

  constructor(opts: AnthropicClientOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.baseUrl = opts.baseUrl ?? ANTHROPIC_BASE_URL;
  }

  async generateStructured(params: GenerateStructuredParams): Promise<LlmResult> {
    const startedAt = Date.now();
    const signal = combineSignals(params.signal, REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          system: appendSchemaHint(params.system, params.schema !== undefined),
          messages: [{ role: "user", content: params.prompt }],
        }),
        signal,
      });
    } catch (err) {
      // Network failure or abort/timeout — retryable. Never echo the raw cause
      // (it can carry request headers including x-api-key).
      const aborted = err instanceof Error && err.name === "AbortError";
      this.trace(params.traceName, startedAt, "ERROR");
      throw new LlmTransient(
        aborted ? "LLM request timed out" : "LLM request network failure"
      );
    }

    if (!response.ok) {
      this.trace(params.traceName, startedAt, "ERROR", response.status);
      throw this.mapHttpError(response);
    }

    let parsed: AnthropicMessageResponse;
    try {
      parsed = (await response.json()) as AnthropicMessageResponse;
    } catch {
      this.trace(params.traceName, startedAt, "ERROR", response.status);
      throw new LlmInvalidOutput("LLM response body was not JSON");
    }

    // A max_tokens stop means the JSON is truncated mid-stream — surface that
    // distinctly so the retry feedback can ask for shorter output instead of
    // an unactionable "no parseable JSON".
    if (parsed.stop_reason === "max_tokens") {
      this.trace(params.traceName, startedAt, "ERROR", response.status);
      throw new LlmInvalidOutput(
        "LLM output was truncated by the completion token limit — respond with more compact JSON (shorter descriptions, no optional fields)"
      );
    }

    const text = (parsed.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");

    const json = extractJson(text);
    if (json === undefined) {
      this.trace(params.traceName, startedAt, "ERROR", response.status);
      throw new LlmInvalidOutput("LLM output contained no parseable JSON");
    }

    const usage: LlmUsage = {
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
    };
    emitTrace({
      name: params.traceName,
      model: this.model,
      usage,
      level: "DEFAULT",
      statusCode: response.status,
    });

    return { json, usage };
  }

  private mapHttpError(response: Response): LlmTransient | LlmRateLimited {
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      return new LlmRateLimited(
        "LLM provider rate limited",
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined
      );
    }
    if (response.status === 529) {
      // Anthropic "overloaded" — back off like a rate limit.
      return new LlmRateLimited("LLM provider overloaded");
    }
    // 5xx and any other non-2xx are treated as transient/retryable. The body
    // is NOT read into the message (it can echo request context).
    return new LlmTransient(
      `LLM provider returned ${response.status}`,
      response.status
    );
  }

  private trace(
    name: string,
    startedAt: number,
    level: "DEFAULT" | "ERROR",
    statusCode?: number
  ): void {
    emitTrace({
      name,
      model: this.model,
      usage: { inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - startedAt },
      level,
      statusCode,
    });
  }
}

