from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_settings


class TokenCryptoError(Exception):
    pass


_PLACEHOLDER_DEFAULT = "dev-only-replace-with-32-bytes-from-secrets-token-hex-32"
_ENV_PLACEHOLDER = "replace-with-32-bytes-of-randomness-from-secrets-token-hex-32"


def _key() -> str:
    key = get_settings().strava_token_key
    # Reject committed placeholders by exact match, and require ≥32-char hex so an
    # operator can't ship something like "changeme" or a low-entropy passphrase.
    if not key or key in (_PLACEHOLDER_DEFAULT, _ENV_PLACEHOLDER):
        raise TokenCryptoError(
            "STRAVA_TOKEN_KEY is unset or still using a placeholder value. "
            "Generate one with `python -c \"import secrets; print(secrets.token_hex(32))\"`."
        )
    if len(key) < 32:
        raise TokenCryptoError(
            f"STRAVA_TOKEN_KEY is too short ({len(key)} chars); require at least 32."
        )
    return key


async def encrypt_strava_token(session: AsyncSession, plaintext: str) -> bytes:
    """Encrypt via pgp_sym_encrypt so the key never leaves the DB session boundary."""
    result = await session.execute(
        text("SELECT pgp_sym_encrypt(:pt, :key) AS enc").bindparams(
            bindparam("pt", value=plaintext),
            bindparam("key", value=_key()),
        )
    )
    enc = result.scalar_one()
    if enc is None:
        raise TokenCryptoError("pgp_sym_encrypt returned NULL")
    return bytes(enc)


async def decrypt_strava_token(session: AsyncSession, ciphertext: bytes) -> str:
    result = await session.execute(
        text("SELECT pgp_sym_decrypt(:ct, :key) AS pt").bindparams(
            bindparam("ct", value=ciphertext),
            bindparam("key", value=_key()),
        )
    )
    pt = result.scalar_one()
    if pt is None:
        raise TokenCryptoError("pgp_sym_decrypt returned NULL")
    return str(pt)
