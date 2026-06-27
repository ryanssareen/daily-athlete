// Dynamic Client Registration (RFC 7591). Open endpoint with per-IP + total
// caps (a public client registry is a storage-DoS surface). Accepts JSON.

import { createAdminClient } from "@/db/admin";
import { registerClient, RegistrationError } from "@/oauth/clients";
import { corsJson, corsPreflight, oauthError } from "@/oauth/http";

export const runtime = "nodejs";

function clientIp(req: Request): string | undefined {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim();
  return req.headers.get("x-real-ip") ?? undefined;
}

export async function POST(req: Request): Promise<Response> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return oauthError("invalid_request", "expected application/json", 415);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return oauthError("invalid_request", "invalid JSON body");
  }
  const obj = (body ?? {}) as Record<string, unknown>;
  const redirectUris = Array.isArray(obj.redirect_uris)
    ? obj.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  const clientName = typeof obj.client_name === "string" ? obj.client_name : undefined;

  const admin = createAdminClient();
  try {
    const client = await registerClient(admin, {
      redirectUris,
      clientName,
      ip: clientIp(req),
    });
    return corsJson(
      {
        client_id: client.client_id,
        redirect_uris: client.redirect_uris,
        client_name: client.client_name,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201
    );
  } catch (e) {
    if (e instanceof RegistrationError) {
      if (e.code === "rate_limited") return oauthError("invalid_request", e.message, 429);
      if (e.code === "capacity") return oauthError("temporarily_unavailable", e.message, 503);
      return oauthError("invalid_redirect_uri", e.message, 400);
    }
    return oauthError("server_error", "registration failed", 500);
  }
}

export function OPTIONS(): Response {
  return corsPreflight();
}
