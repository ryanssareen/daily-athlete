// Groq adapter for the shared LlmClient.
//
// Plain `fetch` against Groq's OpenAI-compatible Chat Completions API —
// the same dependency-light idiom as anthropic.ts (no SDK, MSW-testable).
// Groq hosts open-weight models (Llama, etc.) behind very low latency,
// which suits the synchronous-feeling generation flow.
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

const GROQ_BASE_URL = "https://api.groq.com";
const REQUEST_TIMEOUT_MS = 120_000; // bounded; the Inngest step deadline absorbs the rest
const DEFAULT_MAX_TOKENS = 8192;

interface GroqClientOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
  baseUrl?: string;
}

interface GroqChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class GroqClient implements LlmClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly baseUrl: string;

  constructor(opts: GroqClientOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.baseUrl = opts.baseUrl ?? GROQ_BASE_URL;
  }

  async generateStructured(params: GenerateStructuredParams): Promise<LlmResult> {
    const startedAt = Date.now();
    const signal = combineSignals(params.signal, REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/openai/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_completion_tokens: this.maxTokens,
          messages: [
            {
              role: "system",
              content: appendSchemaHint(params.system, params.schema !== undefined),
            },
            { role: "user", content: params.prompt },
          ],
        }),
        signal,
      });
    } catch (err) {
      // Network failure or abort/timeout — retryable. Never echo the raw cause
      // (it can carry request headers including the bearer token).
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

    let parsed: GroqChatCompletionResponse;
    try {
      parsed = (await response.json()) as GroqChatCompletionResponse;
    } catch {
      this.trace(params.traceName, startedAt, "ERROR", response.status);
      throw new LlmInvalidOutput("LLM response body was not JSON");
    }

    const text = parsed.choices?.[0]?.message?.content ?? "";

    const json = extractJson(text);
    if (json === undefined) {
      this.trace(params.traceName, startedAt, "ERROR", response.status);
      throw new LlmInvalidOutput("LLM output contained no parseable JSON");
    }

    const usage: LlmUsage = {
      inputTokens: parsed.usage?.prompt_tokens ?? 0,
      outputTokens: parsed.usage?.completion_tokens ?? 0,
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
    if (response.status === 498) {
      // Groq flex-tier "capacity exceeded" — back off like a rate limit.
      return new LlmRateLimited("LLM provider over capacity");
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
