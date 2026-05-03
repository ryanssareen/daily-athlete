/**
 * Typed HTTP errors for route handlers.
 *
 * 401 responses always carry `WWW-Authenticate: Bearer` and a generic detail
 * string ("invalid token" / "missing bearer token") — the underlying decode
 * reason is never echoed to clients (ce:review hardening: leaking "expired" vs
 * "bad signature" helps attackers probing for valid tokens).
 *
 * Additional helpers (NotFound, BadRequest, Forbidden) land in the unit that
 * first calls them — keeping this surface scoped to what's actually used.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

export const Unauthorized = (detail = "invalid token") =>
  new ApiError(401, detail, { "WWW-Authenticate": "Bearer" });

export function respondError(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ detail: error.detail }, { status: error.status, headers: error.headers });
  }
  // Avoid leaking internal-error details to clients. Caller should log separately.
  return Response.json({ detail: "internal error" }, { status: 500 });
}
