# secrets/

Local-only secrets. Contents of this directory are gitignored.

## Files expected here

- `AuthKey_<KEY_ID>.p8` — Apple Sign in with Apple private key, downloaded once from
  Apple Developer → Keys. Used by `scripts/apple-jwt.mjs` to mint the Supabase
  client-secret JWT. The Key ID is the 10-character ID Apple assigned when the key
  was created.

## Why this exists

The Flutter app's `.env.production` covers Supabase URL / anon key / API base URL.
This directory holds the *signing* material Apple gives you once — not values that
get baked into a build.
