// Mirror of public.strava_tokens from supabase/migrations/0002_strava_infra.sql
// + 0003_security_hardening.sql (adds key_version).
//
// Sensitive table:
// - Excluded from supabase_realtime publication.
// - Service-role-only writes (Next.js OAuth callback handler).
// - Self-only RLS reads (the user themselves).
//
// Encryption is Node-side AES-256-GCM (see apps/web/src/security/token-crypto.ts).
// The symmetric key never traverses SQL. `key_version` enables incremental key
// rotation: new encryptions use the highest version available; all listed
// versions are tried on decrypt; each row stamps the version it was written
// under. See AGENTS.md "Secrets".

import { z } from "zod";

// PostgreSQL BYTEA representation on the wire.
// - PostgREST returns BYTEA columns as base64-encoded strings by default.
// - supabase-js INSERT accepts Uint8Array/Buffer and serialises for transit.
// Either form is valid for the row contract; conversion happens in
// apps/web/src/security/token-crypto.ts where the bytes are decrypted.
export const EncryptedBytesSchema = z.union([
  z.string(),
  z.instanceof(Uint8Array),
]);
export type EncryptedBytes = z.infer<typeof EncryptedBytesSchema>;

// Strava athlete IDs are BIGINT in SQL but fit comfortably in JS's 53-bit
// safe integer range (~10^10 today). z.number().int() is correct; revisit
// if Strava ever issues IDs larger than 2^53.
export const StravaTokenRowSchema = z.object({
  user_id: z.string().uuid(),
  access_token_enc: EncryptedBytesSchema,
  refresh_token_enc: EncryptedBytesSchema,
  expires_at: z.string().datetime({ offset: true }),
  scope: z.string(),
  athlete_strava_id: z.number().int(),
  // SMALLINT in SQL, NOT NULL DEFAULT 1. Tracks which entry in
  // STRAVA_TOKEN_KEYS was used to encrypt this row.
  key_version: z.number().int().nonnegative(),
  created_at: z.string().datetime({ offset: true }),
  last_used_at: z.string().datetime({ offset: true }).nullable(),
});

export type StravaTokenRow = z.infer<typeof StravaTokenRowSchema>;
