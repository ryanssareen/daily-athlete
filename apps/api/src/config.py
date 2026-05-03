from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Values that must never appear in staging/production env. Anything matching one
# of these triggers a startup failure outside of development/test.
_PLACEHOLDER_JWT_SECRET = "local-jwt-secret-replace-me"  # noqa: S105
_PLACEHOLDER_TOKEN_KEY = "dev-only-replace-with-32-bytes-from-secrets-token-hex-32"  # noqa: S105


class ConfigError(RuntimeError):
    """Raised at startup when configuration is unsafe for the current environment."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["development", "test", "staging", "production"] = "development"
    log_level: str = "info"

    database_url: str = Field(default="postgresql+asyncpg://da2:da2_dev@localhost:54322/da2")
    database_url_sync: str = Field(default="postgresql://da2:da2_dev@localhost:54322/da2")
    database_url_test: str = Field(
        default="postgresql+asyncpg://da2:da2_dev@localhost:54322/da2_test"
    )
    database_url_test_sync: str = Field(
        default="postgresql://da2:da2_dev@localhost:54322/da2_test"
    )

    redis_url: str = "redis://localhost:6379/0"

    supabase_jwt_secret: str = _PLACEHOLDER_JWT_SECRET
    supabase_jwt_issuer: str | None = None
    supabase_jwt_aud: str = "authenticated"

    # Comma-separated list of "version:hex" entries. The highest version is used
    # for new encryptions; all listed versions are tried for decryption (rotation).
    # Empty string falls back to the placeholder for development convenience.
    strava_token_keys: str = ""
    strava_token_key: str = _PLACEHOLDER_TOKEN_KEY  # legacy single-key default
    strava_raw_retention_days: int = 30

    # CORS allowlist for the FastAPI app (comma-separated origins).
    cors_origins: str = "http://localhost:3000,http://localhost:8081"
    # Trusted hostnames for production (comma-separated). Empty = allow all (dev).
    trusted_hosts: str = ""

    sentry_dsn: str | None = None
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str = "https://cloud.langfuse.com"

    @model_validator(mode="after")
    def _validate_secrets_for_env(self) -> "Settings":
        if self.app_env in ("staging", "production"):
            if self.supabase_jwt_secret == _PLACEHOLDER_JWT_SECRET:
                raise ConfigError(
                    "SUPABASE_JWT_SECRET must be set to a real secret in "
                    f"app_env={self.app_env!r}; the committed placeholder is "
                    "trivially exploitable to forge JWTs."
                )
            # Either strava_token_keys or a non-placeholder strava_token_key.
            if (
                not self.strava_token_keys
                and self.strava_token_key == _PLACEHOLDER_TOKEN_KEY
            ):
                raise ConfigError(
                    "STRAVA_TOKEN_KEYS or STRAVA_TOKEN_KEY must be set in "
                    f"app_env={self.app_env!r}; without a real key the encrypted "
                    "Strava tokens are not actually protected."
                )
            if self.trusted_hosts == "":
                raise ConfigError(
                    "TRUSTED_HOSTS must be set in "
                    f"app_env={self.app_env!r} to defend against host-header attacks."
                )
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def trusted_hosts_list(self) -> list[str]:
        return [h.strip() for h in self.trusted_hosts.split(",") if h.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
