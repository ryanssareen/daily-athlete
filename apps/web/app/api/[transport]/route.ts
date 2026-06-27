// Remote MCP endpoint (Streamable HTTP) for the athlete-stats connector.
//
// Mounted as a single-segment dynamic route at the api root so the clean public
// URL is /api/mcp (basePath "/api" derives /api/mcp + /api/sse). Static siblings
// under app/api/* (oauth, plans, inngest, …) take routing precedence over this
// dynamic segment, so it only ever resolves /api/mcp (and /api/sse, disabled).
//
// runtime=nodejs: the auth bridge mints JWTs and the SDK uses node:crypto, which
// cannot run on Edge.

import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { registerAllTools } from "@/mcp/tools";
import { verifyToken } from "@/mcp/identity";

export const runtime = "nodejs";
export const maxDuration = 60;

const base = createMcpHandler(
  (server) => {
    registerAllTools(server);
  },
  { serverInfo: { name: "daily-athlete", version: "0.1.0" } },
  { basePath: "/api", maxDuration: 60, disableSse: true }
);

// Every tool call must carry a valid bearer; an unauthenticated request returns
// 401 + WWW-Authenticate pointing at the protected-resource metadata.
const handler = withMcpAuth(base, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { handler as GET, handler as POST };
