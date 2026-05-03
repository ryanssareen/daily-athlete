/**
 * Test helpers for synthesizing authentication state without hitting Supabase.
 *
 * - mintTestKeyPair() generates an ES256 keypair in-memory; tests sign their
 *   own JWTs with the private key and serve the public key via a tiny in-process
 *   JWKS so `verifyBearer` can be exercised end-to-end without network.
 * - makeAuthUser() inserts a row into auth.users + lets the on_auth_user_created
 *   trigger mirror it into public.users (Wave-1 migration 0001).
 */
import { createServer, type Server } from "node:http";

import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from "jose";
import type pg from "pg";

export interface TestKeyPair {
  publicKey: KeyLike;
  privateKey: KeyLike;
  publicJwk: JWK & { kid: string; alg: "ES256" };
  /** Single-key JWKS document compatible with jose.createRemoteJWKSet. */
  jwks: { keys: Array<JWK & { kid: string; alg: "ES256" }> };
}

export async function mintTestKeyPair(kid = "test-kid-1"): Promise<TestKeyPair> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = (await exportJWK(publicKey)) as JWK;
  const fullJwk = { ...publicJwk, kid, alg: "ES256" as const, use: "sig" };
  return {
    publicKey,
    privateKey,
    publicJwk: fullJwk,
    jwks: { keys: [fullJwk] },
  };
}

export interface ServeJwksResult {
  url: string;
  close: () => Promise<void>;
}

/** Start an HTTP server that serves the given JWKS at /.well-known/jwks.json. */
export async function serveJwks(jwks: object): Promise<ServeJwksResult> {
  const body = JSON.stringify(jwks);
  const server: Server = createServer((req, res) => {
    if (req.url && req.url.endsWith("/.well-known/jwks.json")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("could not determine JWKS server address");
  }
  const url = `http://127.0.0.1:${address.port}/.well-known/jwks.json`;
  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

export interface SignTestTokenOpts {
  sub: string;
  privateKey: KeyLike;
  kid: string;
  issuer?: string;
  audience?: string;
  expiresInSec?: number;
  /** Override or remove specific claims to construct edge-case tokens. */
  withClaims?: Record<string, unknown>;
  /** When true, omit `aud` from the payload entirely. */
  omitAud?: boolean;
  /** When true, omit `iss` from the payload entirely. */
  omitIss?: boolean;
}

export async function signTestToken(opts: SignTestTokenOpts): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (opts.expiresInSec ?? 60);

  const claims: Record<string, unknown> = {
    sub: opts.sub,
    role: "authenticated",
    ...opts.withClaims,
  };
  if (!opts.omitAud) claims.aud = opts.audience ?? "authenticated";
  if (!opts.omitIss && opts.issuer) claims.iss = opts.issuer;

  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: opts.kid, typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(opts.privateKey);
}

/**
 * Insert a row into auth.users (which fires the public.users mirror trigger
 * from migration 0001). Returns the new user's UUID.
 */
export async function makeAuthUser(
  client: pg.Client,
  email?: string,
  roleFlags?: string[],
): Promise<string> {
  const result = await client.query<{ id: string }>(
    "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), $1) RETURNING id",
    [email ?? null],
  );
  const id = result.rows[0].id;
  if (roleFlags) {
    await client.query("UPDATE public.users SET role_flags = $1 WHERE id = $2", [roleFlags, id]);
  }
  return id;
}
