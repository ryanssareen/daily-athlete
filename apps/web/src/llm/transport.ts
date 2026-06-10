// Provider-neutral transport helpers shared by the LlmClient adapters
// (anthropic.ts, groq.ts). No provider specifics live here — only the
// signal/timeout plumbing and the tolerant JSON extraction that every
// adapter applies to model text.

/** Combine an optional caller signal with a hard timeout. */
export function combineSignals(
  caller: AbortSignal | undefined,
  timeoutMs: number
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!caller) return timeout;
  return AbortSignal.any([caller, timeout]);
}

/** Append a compact JSON-only instruction when the caller asked for structured
 * output. Only the PRESENCE of a schema matters here — the schema's shape is a
 * caller-side concern (the caller safeParses); this just nudges the model to
 * emit bare JSON. */
export function appendSchemaHint(system: string, hasSchema: boolean): string {
  if (!hasSchema) return system;
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
