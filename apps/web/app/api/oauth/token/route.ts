// OAuth 2.1 token endpoint. Supports authorization_code (with PKCE) and
// refresh_token (rotating, with reuse detection). Form-encoded only.

import { createAdminClient } from "@/db/admin";
import { consumeAuthCode } from "@/oauth/codes";
import { verifyPkceS256 } from "@/oauth/pkce";
import { issueTokens, rotateRefresh } from "@/oauth/tokens";
import { corsJson, corsPreflight, oauthError } from "@/oauth/http";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", "expected application/x-www-form-urlencoded", 415);
  }
  const form = new URLSearchParams(await req.text());
  const grant = form.get("grant_type");
  const admin = createAdminClient();

  if (grant === "authorization_code") {
    const code = form.get("code");
    const verifier = form.get("code_verifier");
    const redirectUri = form.get("redirect_uri");
    const clientId = form.get("client_id");
    const resource = form.get("resource");
    if (!code || !verifier || !redirectUri || !clientId) {
      return oauthError("invalid_request", "missing required parameters");
    }
    const rec = await consumeAuthCode(admin, code);
    if (!rec) return oauthError("invalid_grant", "authorization code invalid or expired");
    if (rec.client_id !== clientId || rec.redirect_uri !== redirectUri) {
      return oauthError("invalid_grant", "client_id / redirect_uri mismatch");
    }
    if (resource && rec.resource !== resource) {
      return oauthError("invalid_target", "resource mismatch");
    }
    if (!verifyPkceS256(verifier, rec.code_challenge)) {
      return oauthError("invalid_grant", "PKCE verification failed");
    }
    const tokens = await issueTokens(admin, {
      clientId: rec.client_id,
      userId: rec.user_id,
      scope: rec.scope,
      resource: rec.resource,
    });
    return corsJson({
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: rec.scope ?? undefined,
    });
  }

  if (grant === "refresh_token") {
    const refreshToken = form.get("refresh_token");
    if (!refreshToken) return oauthError("invalid_request", "missing refresh_token");
    // Bind to client_id when the client sends it (public clients should).
    const res = await rotateRefresh(admin, refreshToken, form.get("client_id") ?? undefined);
    if (res.result !== "ok") {
      // Both reuse (theft -> family revoked) and invalid surface identically.
      return oauthError("invalid_grant", "refresh token invalid");
    }
    return corsJson({
      access_token: res.tokens.accessToken,
      token_type: "Bearer",
      expires_in: res.tokens.expiresIn,
      refresh_token: res.tokens.refreshToken,
    });
  }

  return oauthError("unsupported_grant_type", `grant_type "${grant ?? ""}" not supported`);
}

export function OPTIONS(): Response {
  return corsPreflight();
}
