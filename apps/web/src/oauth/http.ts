import "server-only";

// Tiny HTTP helpers for the OAuth endpoints: JSON responses with the CORS +
// no-store headers MCP clients (and browser-based discovery) require.

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

export function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...CORS_HEADERS,
    },
  });
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** OAuth 2.0 error body (RFC 6749 §5.2). */
export function oauthError(
  error: string,
  description?: string,
  status = 400
): Response {
  return corsJson(
    description ? { error, error_description: description } : { error },
    status
  );
}
