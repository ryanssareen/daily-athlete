// Best-effort Langfuse tracing for LLM calls.
//
// PII-MINIMIZED BY DESIGN (security review): traces carry only metadata —
// trace name, model, token usage, latency, status. They deliberately do NOT
// carry the prompt or the model output, because the prompt embeds athlete
// health-adjacent free text (injury history) and Langfuse is a third-party
// processor. Inputs/outputs stay in our own Postgres, not in the trace tool.
//
// FAIL-SOFT: a tracing failure (network, misconfig, bad payload) must NEVER
// fail or delay the model call. Everything here is wrapped and swallowed. When
// Langfuse is unconfigured, this is a no-op (no network).

import { config } from "@/config";

import type { LlmUsage } from "./index";

export interface TraceRecord {
  /** Span/trace label, e.g. "generate.skeleton" or "adaptive.replan". */
  name: string;
  model: string;
  usage: LlmUsage;
  /** "DEFAULT" for success, "ERROR" for a failed call. */
  level: "DEFAULT" | "ERROR";
  statusCode?: number;
}

/**
 * Fire-and-forget a trace to Langfuse if configured. Returns immediately on the
 * happy path and swallows every error — callers do not await correctness here.
 */
export function emitTrace(record: TraceRecord): void {
  const { publicKey, secretKey, host } = config.langfuse;
  if (!publicKey || !secretKey || !host) return; // unconfigured -> no-op

  try {
    const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
    const now = new Date().toISOString();
    // Minimal Langfuse ingestion envelope: one trace event, metadata only.
    const body = JSON.stringify({
      batch: [
        {
          id: `${record.name}-${now}`,
          type: "trace-create",
          timestamp: now,
          body: {
            name: record.name,
            metadata: {
              model: record.model,
              inputTokens: record.usage.inputTokens,
              outputTokens: record.usage.outputTokens,
              latencyMs: record.usage.latencyMs,
              level: record.level,
              statusCode: record.statusCode,
            },
          },
        },
      ],
    });

    void fetch(`${host.replace(/\/$/, "")}/api/public/ingestion`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${auth}`,
      },
      body,
      // Bound the best-effort call so a hung Langfuse can't pile up.
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      // swallow — observability is never allowed to break generation
    });
  } catch {
    // swallow synchronous failures (e.g. Buffer/env edge cases) too
  }
}
