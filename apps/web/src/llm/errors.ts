// Typed errors surfaced by the shared LLM client.
//
// Callers (the generation Inngest worker, the adaptive proposer via propose.ts)
// branch on `code` to map a failure onto Inngest retry behavior WITHOUT
// inspecting HTTP status codes or leaking provider response bodies into logs:
//   - rate_limited   -> RetryAfterError (back off, do not burn attempts)
//   - transient      -> let Inngest retry
//   - invalid_output -> non-retriable after the caller's safeParse retries
//
// Mirrors the shape of apps/web/src/strava/errors.ts: a base class with a
// stable `code` wire identifier and named subclasses. The provider message is
// deliberately NOT interpolated with the API key, and the raw provider error
// (which can echo request headers) is mapped here, never logged verbatim.

export type LlmErrorCode = "rate_limited" | "transient" | "invalid_output";

export class LlmError extends Error {
  public readonly code: LlmErrorCode;
  public readonly status?: number;

  constructor(code: LlmErrorCode, message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.status = status;
  }
}

/** 429 / provider-overloaded. Carries the retry hint when the provider gives one. */
export class LlmRateLimited extends LlmError {
  public readonly retryAfterSeconds?: number;
  constructor(message = "LLM provider rate limited", retryAfterSeconds?: number) {
    super("rate_limited", message, 429);
    this.name = "LlmRateLimited";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** 5xx, network failure, or timeout — safe to retry. */
export class LlmTransient extends LlmError {
  constructor(message = "LLM provider transient failure", status?: number) {
    super("transient", message, status);
    this.name = "LlmTransient";
  }
}

/** Response could not be parsed into JSON. The caller owns schema validation;
 * this fires only when there is no JSON to hand back at all. */
export class LlmInvalidOutput extends LlmError {
  constructor(message = "LLM produced unparseable output") {
    super("invalid_output", message);
    this.name = "LlmInvalidOutput";
  }
}

/** True for LLM failures that should back off (rate-limit / transient) rather
 * than consume a parse/regenerate attempt. Both propose.ts and generate.ts
 * branch on this to re-throw, so the Inngest worker maps them to RetryAfterError
 * instead of burning the per-call retry budget on provider hiccups. */
export function isLlmBackOff(err: unknown): err is LlmError {
  return (
    err instanceof LlmError &&
    (err.code === "rate_limited" || err.code === "transient")
  );
}
