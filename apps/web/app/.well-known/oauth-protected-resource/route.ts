// RFC 9728 Protected Resource Metadata. Points Claude at this app as its own
// OAuth authorization server (issuer = the app origin). The MCP 401 carries
// `resource_metadata` pointing here; this doc names the authorization server.

import {
  getPublicOrigin,
  metadataCorsOptionsRequestHandler,
} from "mcp-handler";

export const runtime = "nodejs";

export function GET(req: Request): Response {
  const origin = getPublicOrigin(req).replace(/\/+$/, "");
  // RFC 9728: `resource` must be the URL of the protected resource (the MCP
  // endpoint), not just the origin. Claude.ai echoes this value back as the
  // `resource` parameter in the authorize request; our authorize endpoint
  // validates it against canonicalResource(), so they must match.
  return new Response(
    JSON.stringify({
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
    }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } }
  );
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
