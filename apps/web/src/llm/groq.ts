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
// Output-token cap. The model supports 32k completions and a long multi-month
// plan can need well past 8k tokens of strict JSON — but Groq counts
// max_completion_tokens against the account's per-minute token budget (TPM), and
// the free `on_demand` tier caps TPM at 12k. Requesting 32k there fails the
// WHOLE call with HTTP 413 (rate_limit_exceeded) before any output is produced
// (observed in prod: "Limit 12000, Requested 33253"). Cap at 8k so a single
// request fits the free tier; long plans may truncate, which is handled below
// via finish_reason==="length". Raise this back toward 32k once the Groq
// account is on a paid tier (console.groq.com/settings/billing).
const DEFAULT_MAX_TOKENS = 8_000;

interface GroqClientOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
  baseUrl?: string;
}

interface GroqChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
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
      // DEBUG (diagnose "generation always fails"): Groq's error body carries
      // the actionable cause (e.g. {"code":"invalid_api_key"}, model
      // decommissioned) and was otherwise discarded — only the status survived
      // into LlmTransient. Log it server-side (it is the PROVIDER's error, never
      // the prompt); bound the length to avoid log spam.
      await this.logErrorBody(params.traceName, response);
      throw this.mapHttpError(response);
    }

    let parsed: GroqChatCompletionResponse;
    try {
      parsed = (await response.json()) as GroqChatCompletionResponse;
    } catch {
      this.trace(params.traceName, startedAt, "ERROR", response.status);
      throw new LlmInvalidOutput("LLM response body was not JSON");
    }

    const choice = parsed.choices?.[0];
    const text = choice?.message?.content ?? "";

    // A length-stop means the JSON is truncated mid-stream — surface that
    // distinctly so the retry feedback can ask for shorter output instead of
    // an unactionable "no parseable JSON".
    if (choice?.finish_reason === "length") {
      this.trace(params.traceName, startedAt, "ERROR", response.status);
      throw new LlmInvalidOutput(
        "LLM output was truncated by the completion token limit — respond with more compact JSON (shorter descriptions, no optional fields)"
      );
    }

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

  /** DEBUG: surface the provider error body (cause) before it is mapped away. */
  private async logErrorBody(traceName: string, response: Response): Promise<void> {
    let body = "";
    try {
      body = (await response.clone().text()).slice(0, 1000);
    } catch {
      body = "<unreadable>";
    }
    console.error(
      "[llm][debug] groq non-2xx response",
      JSON.stringify({
        trace: traceName,
        model: this.model,
        status: response.status,
        body,
      })
    );
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
