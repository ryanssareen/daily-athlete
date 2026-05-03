"""Strava token encryption.

Uses Fernet (AES-128-CBC + HMAC-SHA256) from the `cryptography` package. The
symmetric key is held in process memory only — never bound into SQL — so a
verbose Postgres log or a leaked pg_stat_statements row cannot recover it.

Multiple keys are supported via `STRAVA_TOKEN_KEYS = "1:<urlsafe_b64>,2:<...>"`.
The highest version is used for new encryptions; decrypt iterates known versions
so existing rows continue to decrypt across rotation.

For convenience, a single `STRAVA_TOKEN_KEY` (urlsafe base64, 32 bytes decoded
or hex, optionally just any string ≥32 chars that we KDF) is also accepted as
version 1.
"""
from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from src.config import _PLACEHOLDER_TOKEN_KEY, get_settings


class TokenCryptoError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class _KeyEntry:
    version: int
    fernet: Fernet


def _coerce_to_fernet_key(raw: str) -> bytes:
    """Accept urlsafe-base64 32-byte keys verbatim; otherwise derive a 32-byte
    key from the input via SHA-256 and base64-encode for Fernet.

    Hashing means rotating to a new operator-chosen key produces a fresh Fernet
    key without requiring the operator to also produce valid base64 of exact
    length. The KDF is intentionally simple — operators are expected to ship
    high-entropy material; this exists to handle hex strings and ad-hoc keys.
    """
    raw_bytes = raw.encode("utf-8")
    # Already a valid Fernet key?
    try:
        decoded = base64.urlsafe_b64decode(raw_bytes)
        if len(decoded) == 32:
            return raw_bytes
    except (ValueError, base64.binascii.Error):
        pass
    digest = hashlib.sha256(raw_bytes).digest()
    return base64.urlsafe_b64encode(digest)


def _parse_keys() -> list[_KeyEntry]:
    settings = get_settings()
    entries: list[_KeyEntry] = []

    # Multi-key form: "1:<key>,2:<key>"
    if settings.strava_token_keys:
        for chunk in settings.strava_token_keys.split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            if ":" not in chunk:
                raise TokenCryptoError(
                    f"STRAVA_TOKEN_KEYS entry {chunk!r} missing 'version:' prefix"
                )
            version_str, raw_key = chunk.split(":", 1)
            try:
                version = int(version_str)
            except ValueError as exc:
                raise TokenCryptoError(
                    f"STRAVA_TOKEN_KEYS version {version_str!r} is not an integer"
                ) from exc
            if version < 1:
                raise TokenCryptoError("token-key versions must be >= 1")
            entries.append(
                _KeyEntry(version=version, fernet=Fernet(_coerce_to_fernet_key(raw_key)))
            )

    # Single-key fallback (version 1).
    elif settings.strava_token_key:
        if settings.strava_token_key == _PLACEHOLDER_TOKEN_KEY:
            raise TokenCryptoError(
                "STRAVA_TOKEN_KEY is still the placeholder. Generate one with "
                "`python -c 'import secrets; print(secrets.token_urlsafe(32))'`."
            )
        if len(settings.strava_token_key) < 32:
            raise TokenCryptoError(
                f"STRAVA_TOKEN_KEY too short ({len(settings.strava_token_key)} chars); "
                "require at least 32."
            )
        entries.append(
            _KeyEntry(
                version=1,
                fernet=Fernet(_coerce_to_fernet_key(settings.strava_token_key)),
            )
        )

    if not entries:
        raise TokenCryptoError("no Strava token keys configured")

    # Highest version first — that's the encryption key.
    entries.sort(key=lambda e: e.version, reverse=True)
    return entries


@lru_cache(maxsize=1)
def _keys() -> list[_KeyEntry]:
    return _parse_keys()


def reset_key_cache() -> None:
    """Drop the parsed-keys cache. Call after env vars change in tests."""
    _keys.cache_clear()


def encrypt_strava_token(plaintext: str) -> tuple[bytes, int]:
    """Encrypt a Strava token. Returns (ciphertext, key_version)."""
    keys = _keys()
    primary = keys[0]
    return primary.fernet.encrypt(plaintext.encode("utf-8")), primary.version


def decrypt_strava_token(ciphertext: bytes, key_version: int) -> str:
    """Decrypt a Strava token using the key matching `key_version`."""
    for entry in _keys():
        if entry.version == key_version:
            try:
                return entry.fernet.decrypt(ciphertext).decode("utf-8")
            except InvalidToken as exc:
                raise TokenCryptoError(
                    f"decryption failed for key_version {key_version}: invalid ciphertext"
                ) from exc
    raise TokenCryptoError(
        f"no key configured for key_version {key_version}; rotate keys via STRAVA_TOKEN_KEYS"
    )
