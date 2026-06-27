// RFC 9728 Protected Resource Metadata. Points Claude at this app as its own
// OAuth authorization server (issuer = the app origin). The MCP 401 carries
// `resource_metadata` pointing here; this doc names the authorization server.

import {
  getPublicOrigin,
  metadataCorsOptionsRequestHandler,
  protectedResourceHandler,
} from "mcp-handler";

export const runtime = "nodejs";

export function GET(req: Request): Response {
  const origin = getPublicOrigin(req);
  return protectedResourceHandler({ authServerUrls: [origin] })(req);
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
