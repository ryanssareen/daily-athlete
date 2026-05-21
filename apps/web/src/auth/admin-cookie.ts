// Cookie name + attributes for the admin session, shared between the Edge
// middleware (coarse presence gate) and the Node-runtime session verifier.
//
// This module MUST stay edge-safe: no `node:crypto`, no `server-only`, no DB
// imports. middleware.ts runs in the Edge runtime and imports the cookie NAME
// from here; the cryptographic verification lives in admin-session.ts
// (Node-only, `server-only`).
//
// The `__Host-` prefix is the strongest cookie scoping the browser offers
// (requires Secure + Path=/ + no Domain). It only works over HTTPS, so we drop
// the prefix and the Secure flag outside production where local dev runs on
// http://localhost.

const isProd = process.env.NODE_ENV === "production";

export const ADMIN_COOKIE_NAME = isProd
  ? "__Host-da2-admin-session"
  : "da2-admin-session";

export const ADMIN_LOGIN_PATH = "/admin/login";

export interface AdminCookieAttrs {
  httpOnly: true;
  secure: boolean;
  sameSite: "strict";
  path: "/";
  maxAge?: number;
}

/**
 * Cookie attributes for set/clear. Pass `maxAgeSeconds` when setting a live
 * session; pass 0 to clear. `Secure` is on in production only, so the cookie
 * is still sent over http://localhost in dev.
 */
export function adminCookieAttrs(maxAgeSeconds?: number): AdminCookieAttrs {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    ...(maxAgeSeconds !== undefined ? { maxAge: maxAgeSeconds } : {}),
  };
}
