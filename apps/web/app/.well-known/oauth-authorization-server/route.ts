// RFC 8414 Authorization Server Metadata. The app is its own OAuth 2.1 AS:
// issuer = origin, with authorize/token/register endpoints. Advertises S256-only
// PKCE and public-client (`none`) token-endpoint auth, matching what the
// connector enforces.

import { getPublicOrigin } from "mcp-handler";

import { corsJson, corsPreflight } from "@/oauth/http";

export const runtime = "nodejs";

export function GET(req: Request): Response {
  const origin = getPublicOrigin(req);
  return corsJson({
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["athlete"],
  });
}

export function OPTIONS(): Response {
  return corsPreflight();
}
