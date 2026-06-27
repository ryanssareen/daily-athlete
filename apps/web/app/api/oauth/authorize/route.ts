// OAuth 2.1 authorization endpoint (auth code + PKCE).
//
// Order matters for the open-redirect defense: client_id and redirect_uri are
// validated FIRST and any failure there renders an error PAGE (never a redirect
// to an unvalidated URI). Only after both are known-good do other errors redirect
// back to the client with ?error=. Login is delegated to the app's Supabase
// sign-in (same-origin `next`), and the validated request is carried across the
// consent POST in a server-HMAC-signed token (state.ts), so the returning POST
// can't be tampered with.

import { createClient } from "@/auth/server";
import { config } from "@/config";
import { createAdminClient } from "@/db/admin";
import { createAuthCode } from "@/oauth/codes";
import { getClient } from "@/oauth/clients";
import { isS256Method } from "@/oauth/pkce";
import { signState, verifyState } from "@/oauth/state";

export const runtime = "nodejs";

interface ConsentPayload {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  scope: string;
  client_state: string;
  user_id: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function errorPage(error: string, description: string): Response {
  return htmlResponse(
    `<!doctype html><meta charset="utf-8"><title>Authorization error</title>` +
      `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">` +
      `<h1>Couldn’t authorize the connector</h1>` +
      `<p><strong>${esc(error)}</strong></p><p>${esc(description)}</p></body>`,
    400
  );
}

function redirectError(
  redirectUri: string,
  clientState: string | null,
  error: string,
  description?: string
): Response {
  const dest = new URL(redirectUri);
  dest.searchParams.set("error", error);
  if (description) dest.searchParams.set("error_description", description);
  if (clientState) dest.searchParams.set("state", clientState);
  return Response.redirect(dest.toString(), 302);
}

function consentPage(opts: {
  clientName: string;
  redirectHost: string;
  scope: string;
  reqToken: string;
}): Response {
  return htmlResponse(
    `<!doctype html><meta charset="utf-8"><title>Connect to Daily-Athlete</title>` +
      `<body style="font-family:system-ui;max-width:30rem;margin:4rem auto;padding:0 1rem;line-height:1.5">` +
      `<h1>Connect to Daily-Athlete</h1>` +
      `<p><strong>${esc(opts.clientName)}</strong> wants to read and write your training data ` +
      `(scope: <code>${esc(opts.scope)}</code>).</p>` +
      `<p>After approval you'll be redirected to <strong>${esc(opts.redirectHost)}</strong>.</p>` +
      `<form method="POST" action="/api/oauth/authorize" style="display:flex;gap:.75rem;margin-top:1.5rem">` +
      `<input type="hidden" name="req" value="${esc(opts.reqToken)}">` +
      `<button name="decision" value="approve" style="padding:.6rem 1.2rem;font-size:1rem;border:0;border-radius:.5rem;background:#111;color:#fff;cursor:pointer">Approve</button>` +
      `<button name="decision" value="deny" style="padding:.6rem 1.2rem;font-size:1rem;border:1px solid #ccc;border-radius:.5rem;background:#fff;cursor:pointer">Deny</button>` +
      `</form></body>`
  );
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.searchParams;
  const clientId = p.get("client_id");
  const redirectUri = p.get("redirect_uri");

  // 1. Validate client + redirect URI before anything can redirect.
  if (!clientId || !redirectUri) {
    return errorPage("invalid_request", "missing client_id or redirect_uri");
  }
  const admin = createAdminClient();
  const client = await getClient(admin, clientId);
  if (!client) return errorPage("invalid_client", "unknown client_id");
  if (!client.redirect_uris.includes(redirectUri)) {
    return errorPage("invalid_request", "redirect_uri is not registered for this client");
  }

  // 2. Now safe to redirect errors back to the client.
  const clientState = p.get("state");
  if (p.get("response_type") !== "code") {
    return redirectError(redirectUri, clientState, "unsupported_response_type");
  }
  if (!isS256Method(p.get("code_challenge_method"))) {
    return redirectError(redirectUri, clientState, "invalid_request", "code_challenge_method must be S256");
  }
  const codeChallenge = p.get("code_challenge");
  if (!codeChallenge) {
    return redirectError(redirectUri, clientState, "invalid_request", "missing code_challenge");
  }
  const resource = p.get("resource");
  if (!resource) {
    return redirectError(redirectUri, clientState, "invalid_target", "missing resource parameter");
  }

  // 3. Require a Supabase session; delegate to same-origin sign-in if absent.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const signin = new URL("/sign-in", url.origin);
    signin.searchParams.set("next", `${url.pathname}${url.search}`);
    return Response.redirect(signin.toString(), 302);
  }

  // 4. Consent. Carry the validated request in a signed token.
  const key = config.mcpOAuth.stateSigningKey;
  if (!key) return errorPage("server_error", "authorization server not configured");
  const reqToken = signState(
    {
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      resource,
      scope: p.get("scope") ?? "",
      client_state: clientState ?? "",
      user_id: user.id,
    },
    key
  );
  return consentPage({
    clientName: client.client_name ?? clientId,
    redirectHost: new URL(redirectUri).host,
    scope: p.get("scope") ?? "athlete",
    reqToken,
  });
}

export async function POST(req: Request): Promise<Response> {
  // Fail closed on cross-site form posts (CSRF posture, mirrors admin routes).
  const sfs = req.headers.get("sec-fetch-site");
  if (sfs && sfs !== "same-origin" && sfs !== "none") {
    return errorPage("access_denied", "cross-site request rejected");
  }
  const form = new URLSearchParams(await req.text());
  const reqToken = form.get("req");
  const key = config.mcpOAuth.stateSigningKey;
  if (!reqToken || !key) return errorPage("invalid_request", "missing consent context");

  const payload = verifyState<ConsentPayload>(reqToken, key);
  if (!payload) return errorPage("invalid_request", "consent context expired or invalid; restart the connection");

  // Re-confirm the live session matches the user who was shown consent.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== payload.user_id) {
    return errorPage("access_denied", "session mismatch; please restart the connection");
  }

  if (form.get("decision") !== "approve") {
    return redirectError(payload.redirect_uri, payload.client_state || null, "access_denied");
  }

  const admin = createAdminClient();
  const code = await createAuthCode(admin, {
    client_id: payload.client_id,
    user_id: payload.user_id,
    redirect_uri: payload.redirect_uri,
    code_challenge: payload.code_challenge,
    resource: payload.resource,
    scope: payload.scope || null,
  });

  const dest = new URL(payload.redirect_uri);
  dest.searchParams.set("code", code);
  if (payload.client_state) dest.searchParams.set("state", payload.client_state);
  return Response.redirect(dest.toString(), 302);
}
