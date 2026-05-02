from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    supabase_jwt_secret: str = "local-jwt-secret-replace-me"

    strava_token_key: str = Field(
        default="dev-only-replace-with-32-bytes-from-secrets-token-hex-32"
    )
    strava_raw_retention_days: int = 30

    sentry_dsn: str | None = None
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str = "https://cloud.langfuse.com"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
