#!/usr/bin/env node
// Sign an Apple OAuth client-secret JWT for Supabase Sign in with Apple.
//
// Usage:
//   node scripts/apple-jwt.mjs <TEAM_ID> <SERVICES_ID> <KEY_ID> <PATH_TO_P8>
//
// Example:
//   node scripts/apple-jwt.mjs \
//     R7HV9V7LDY \
//     com.da2.dailyAthlete.signin \
//     554PR43X56 \
//     secrets/AuthKey_554PR43X56.p8
//
// Prints the JWT to stdout. Paste it into Supabase → Auth → Providers → Apple → Secret Key.
// JWT expires in ~6 months (Apple's max). Regenerate before expiry or new sign-ins break.

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [, , teamId, servicesId, keyId, p8Path] = process.argv;
if (!teamId || !servicesId || !keyId || !p8Path) {
  console.error('Usage: node apple-jwt.mjs <TEAM_ID> <SERVICES_ID> <KEY_ID> <PATH_TO_P8>');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const header = { alg: 'ES256', kid: keyId };
const payload = {
  iss: teamId,
  iat: now,
  exp: now + 60 * 60 * 24 * 180,
  aud: 'https://appleid.apple.com',
  sub: servicesId,
};

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const signingInput = `${b64url(header)}.${b64url(payload)}`;

const key = readFileSync(p8Path, 'utf8');
const sig = createSign('SHA256')
  .update(signingInput)
  .sign({ key, dsaEncoding: 'ieee-p1363' });

console.log(`${signingInput}.${sig.toString('base64url')}`);
