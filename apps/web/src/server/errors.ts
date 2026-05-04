/**
 * Typed HTTP errors for route handlers.
 *
 * 401 responses always carry `WWW-Authenticate: Bearer` and a generic detail
 * string ("invalid token" / "missing bearer token") — the underlying decode
 * reason is never echoed to clients (ce:review hardening: leaking "expired" vs
 * "bad signature" helps attackers probing for valid tokens).
 *
 * 5xx responses always carry the generic detail "internal error" — the
 * underlying cause is never serialized to the wire, but `respondError` logs
 * it server-side via `console.error` so ops can correlate a 500 with the
 * actual error from runtime logs. ApiError accepts an optional `cause` so
 * route handlers can wrap a Supabase error or other failure with the same
 * generic-on-the-wire posture without losing the diagnostic context.
 *
 * Additional helpers (NotFound, BadRequest, Forbidden) land in the unit that
 * first calls them — keeping this surface scoped to what's actually used.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
    public readonly headers: Record<string, string> = {},
    public readonly cause?: unknown,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

export const Unauthorized = (detail = "invalid token") =>
  new ApiError(401, detail, { "WWW-Authenticate": "Bearer" });

/**
 * Convert any error into an HTTP Response with a generic body. ApiErrors are
 * serialized using their declared status / detail / headers. Unknown errors
 * collapse to 500 "internal error" — and ApiErrors at 5xx that carry a
 * `cause` (or any non-ApiError throw) get logged via `console.error` first
 * so the underlying cause is visible in Vercel runtime logs.
 *
 * The wire body is identical regardless of cause — only the log line differs.
 */
export function respondError(error: unknown): Response {
  if (error instanceof ApiError) {
    if (error.status >= 500 && error.cause !== undefined) {
      logUnexpectedError(error.cause, error.detail);
    }
    return Response.json(
      { detail: error.detail },
      { status: error.status, headers: error.headers },
    );
  }
  // Non-ApiError throw — log server-side so the failure is debuggable, then
  // return a generic body so we don't leak details to the wire.
  logUnexpectedError(error, "non-ApiError throw");
  return Response.json({ detail: "internal error" }, { status: 500 });
}

function logUnexpectedError(cause: unknown, context: string): void {
  // Best-effort structured logging: stringify so PostgrestError-shaped objects
  // and plain Errors both surface their fields. console.error goes to stderr
  // which Vercel collects as runtime logs.
  //
  // Wrapped in try/catch as ce:review hardening — `console.error` will invoke
  // toString() on the cause, and a hostile cause (e.g., an upstream object
  // whose toString throws, or a circular structure that some loggers reject)
  // could otherwise unwind out of respondError and prevent the route handler
  // from sending its 500 response, stalling the request until the function
  // timeout. Logging is best-effort; never block the response on it.
  try {
    // eslint-disable-next-line no-console
    console.error(`[respondError] ${context}:`, cause);
  } catch {
    // Last resort — if the structured cause itself can't be logged, at least
    // record the context line so ops know an error occurred.
    try {
      // eslint-disable-next-line no-console
      console.error(`[respondError] ${context}: (cause not loggable)`);
    } catch {
      // Give up. The response is what matters.
    }
  }
}
