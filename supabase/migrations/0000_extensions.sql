-- Enable extensions used across the schema.
-- pgcrypto: gen_random_uuid() and pgp_sym_encrypt/decrypt for Strava token storage.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
