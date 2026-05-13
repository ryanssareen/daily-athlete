---
title: Strava Token Encryption (AES-256-GCM + Versioned Keys)
date: 2026-05-13
status: active
---

# Strava Token Encryption

How Strava OAuth tokens are encrypted before storage, how key rotation
works, and how operators detect a misconfigured production deploy before
the first athlete connects.

## Where the code lives

- `apps/web/src/security/token-crypto.ts` — the module. AES-256-GCM via
  `node:crypto`. Three exports: `encrypt`, `decrypt`, `currentKeyVersion`.
- `apps/web/src/security/__tests__/token-crypto.test.ts` — round-trip,
  rotation, tampering, env-var validation, edge cases.
- `apps/web/src/config.ts` — the boot-time validator that refuses production
  startup when `STRAVA_TOKEN_KEYS` is missing or contains placeholders.
- `supabase/migrations/0002_strava_infra.sql` + `0003_security_hardening.sql`
  — define `strava_tokens.access_token_enc / refresh_token_enc` (BYTEA) and
  the `key_version` column.

## On-disk layout

A `strava_tokens` row stores ciphertext as a single self-contained BYTEA:

```
iv(12 bytes) || authTag(16 bytes) || ciphertext(N bytes)
```

The decryptor reads the three regions by fixed offset. There is no
separate auth-tag column and no length prefix — the BYTEA length tells us
how many bytes of ciphertext are at the end.

Each row also records `key_version SMALLINT NOT NULL` so we know which key
to try first when decrypting and so rotation can be incremental.

## STRAVA_TOKEN_KEYS env var

```
STRAVA_TOKEN_KEYS=1:<64-hex>,2:<64-hex>,3:<64-hex>
```

- Entries are `<positive-integer>:<64-hex-chars>` joined with commas.
- Each hex value decodes to exactly **32 bytes (256 bits)**.
- Highest-numbered version is the **current** one — `encrypt` always uses it.
- `decrypt(ciphertext, keyVersion)` looks up that specific version. All
  listed versions are retained so older rows still decrypt.
- Duplicate versions, non-integer versions, non-hex characters, and
  wrong-length keys all throw at module load.

Generate a fresh key:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Macos/Linux/Windows-portable; no `brew install openssl` required.

## Key rotation procedure

1. Generate a new key (above).
2. Append it to `STRAVA_TOKEN_KEYS` with the next version number:
   `STRAVA_TOKEN_KEYS=1:<old>,2:<new>`.
3. Deploy. From this moment, every refresh writes ciphertext with
   `key_version = 2`. Old rows (`key_version = 1`) still decrypt with the
   original key.
4. Optional follow-up: a one-off backfill script that re-encrypts old rows
   with the new version. Not required for safety — old keys keep decrypting
   indefinitely — but lets you remove the old key from the env eventually.
5. Once every row's `key_version = 2`, drop the version-1 entry from the
   env var. The next deploy can no longer decrypt version-1 ciphertext, so
   only do this after the backfill confirms zero rows remain.

## Production placeholder protection

`apps/web/src/config.ts` runs at boot. In `NODE_ENV=production` it refuses
to construct the config object when any of the following holds for
`STRAVA_TOKEN_KEYS`:

- Missing or empty
- Literal placeholders `hex`, `xxx`, or `''`
- A key that decodes to all-zero bytes
- A key of the wrong length (not 32 bytes)
- Non-hex characters in the key value
- Duplicate version numbers

In `development` and `test` these checks are skipped to keep local-dev
boots smooth (e.g., a contributor running `next dev` without a Strava app
set up). The module's first real `encrypt` / `decrypt` call still throws on
malformed input, so dev workflows that don't touch Strava still boot, and
the ones that do touch it surface a clear error at call time.

## Why this shape

- **AES-256-GCM** — authenticated encryption: tampering with either the
  ciphertext or auth tag is detected at decrypt time. Library is in the
  Node stdlib, so no third-party dep.
- **Versioned keys** — operational requirement: we need to rotate keys
  without a maintenance window. The version column lets rotation be a
  rolling deploy rather than a Big Bang.
- **Layout `iv || authTag || ciphertext`** — single BYTEA column is enough;
  no separate auth-tag column to keep in sync. The 12-byte IV and 16-byte
  tag are GCM defaults; the layout matches the typical reference
  implementations and is what the test suite pins.
- **Bytes in, bytes out** — `encrypt(Uint8Array): Uint8Array`. Callers
  convert strings via `TextEncoder` / `TextDecoder` at the boundary. Keeps
  the crypto module unaware of charset and JSON considerations.

## What this does NOT do

- It does not store the keys. Keys live in Vercel env vars / GitHub
  Actions secrets / local `.env.local`.
- It does not pad plaintext. GCM doesn't need it.
- It does not encode the ciphertext for transport. The BYTEA layer handles
  on-the-wire encoding (PostgREST returns base64 by default; supabase-js
  accepts both Buffer and Uint8Array on insert).
- It does not validate that the key bytes were generated from a CSPRNG.
  That's a deployment-time responsibility, mitigated by the all-zero check
  in production.
