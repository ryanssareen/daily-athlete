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
          system: appendSchemaHint(params.system, params.schema),
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

/** Combine an optional caller signal with a hard timeout. */
function combineSignals(caller: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!caller) return timeout;
  return AbortSignal.any([caller, timeout]);
}

/** Append a compact JSON-only instruction so the model returns parseable JSON.
 * The Zod schema is a soft hint; the caller still safeParses. */
function appendSchemaHint(system: string, schema: unknown): string {
  if (!schema) return system;
  return `${system}\n\nRespond with ONLY a single valid JSON value and no prose, code fences, or commentary.`;
}

/**
 * Pull a JSON value out of model text. Handles a clean JSON body, a
 * ```json fenced block, and prose surrounding a single object/array. Returns
 * `undefined` when nothing parses (caller throws LlmInvalidOutput).
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const candidates: string[] = [trimmed];

  // Strip a ```json ... ``` (or bare ```) fence if present.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());

  // First balanced {...} or [...] region.
  const objStart = trimmed.indexOf("{");
  const arrStart = trimmed.indexOf("[");
  const start =
    objStart === -1
      ? arrStart
      : arrStart === -1
        ? objStart
        : Math.min(objStart, arrStart);
  if (start >= 0) {
    const open = trimmed[start];
    const close = open === "{" ? "}" : "]";
    const end = trimmed.lastIndexOf(close);
    if (end > start) candidates.push(trimmed.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}
