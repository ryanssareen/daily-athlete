// POST /api/admin/playground -- invoke ONE allow-listed, non-destructive admin
// endpoint and return its live response. This is the admin "API playground".
//
// Guardrails (docs/brainstorms/2026-05-21-admin-dashboard-requirements.md,
// "Deferred (post-v1)" -> "API explorer"):
//  - SERVER-SIDE ALLOW-LIST only. The client sends an endpoint *id* + params,
//    never a URL or path. Unknown id => 400.
//  - OPERATOR SESSION ONLY, never the service-role client. We re-invoke the real
//    GET handler in-process with the caller's OWN cookie forwarded, so that
//    handler's requireAdmin re-authenticates as the operator. The playground
//    builds no Supabase client of its own.
//  - Runs through the existing gate + Sec-Fetch-Site CSRF guard.
//  - GET-only / non-destructive (the allow-list + the hard-coded GET dispatch).
//  - Every invocation is audited with NON-PII metadata (endpoint id + status
//    only -- never the params, which may contain an email, nor the body).

import { NextResponse } from "next/server";

import { buildQuery, findEndpoint } from "@/admin/playground";
import { requireAdmin } from "@/auth/admin-guard";
import { clientIp, isSameOriginRequest } from "@/auth/admin-session";
import { writeAudit } from "@/db/admin-audit";

import { GET as backupsGET } from "../backups/route";
import { GET as backupsStatusGET } from "../backups/status/route";
import { GET as usersGET } from "../users/route";

type Handler = (request: Request) => Promise<Response>;

// Maps allow-list id -> the real route handler. Kept beside the route (not in
// the client-importable allow-list module) so the metadata never pulls server
// handlers into the client bundle. Every PLAYGROUND_ENDPOINTS id must have an
// entry here; a route test asserts each id dispatches rather than 400s.
const DISPATCH: Record<string, Handler> = {
  users: usersGET,
  backups: backupsGET,
  "backups.status": backupsStatusGET,
};

// Forwarded onto the synthesized request so the downstream handler's gate +
// audit see the real operator session and client IP (the in-process Request has
// no socket of its own).
const FORWARD_HEADERS = ["cookie", "x-forwarded-for", "x-real-ip", "x-vercel-forwarded-for"];

interface InvokeBody {
  endpointId?: unknown;
  params?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(request.headers)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  let body: InvokeBody;
  try {
    body = (await request.json()) as InvokeBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const endpointId = typeof body.endpointId === "string" ? body.endpointId : "";
  const endpoint = findEndpoint(endpointId);
  const handler = DISPATCH[endpointId];
  if (!endpoint || !handler) {
    return NextResponse.json({ error: "unknown_endpoint" }, { status: 400 });
  }

  const rawParams =
    body.params && typeof body.params === "object"
      ? (body.params as Record<string, unknown>)
      : {};

  // Canonical path from the allow-list (NEVER client input) + whitelisted query.
  const url = new URL(request.url);
  url.pathname = endpoint.path;
  url.search = buildQuery(endpoint, rawParams);

  const headers = new Headers();
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let status: number;
  let payload: unknown;
  try {
    const res = await handler(new Request(url, { method: "GET", headers }));
    status = res.status;
    payload = await res.json().catch(() => null);
  } catch {
    status = 502;
    payload = { error: "dispatch_failed" };
  }

  await writeAudit({
    action: "admin.playground.invoke",
    ip: clientIp(request.headers),
    sessionId: gate.sessionId,
    target: endpoint.id,
    metadata: { endpoint: endpoint.id, status },
  });

  return NextResponse.json({ status, body: payload });
}
