"""Verify the placeholder-secret startup guard refuses unsafe configs."""
import pytest

from src.config import (
    ConfigError,
    Settings,
    _PLACEHOLDER_JWT_SECRET,
    _PLACEHOLDER_TOKEN_KEY,
)


def _kwargs(**overrides) -> dict:
    base = {
        "app_env": "development",
        "supabase_jwt_secret": "real-secret-via-env",
        "strava_token_keys": "1:" + ("a" * 32),
        "trusted_hosts": "",
    }
    base.update(overrides)
    return base


def test_development_accepts_placeholders() -> None:
    Settings(
        app_env="development",
        supabase_jwt_secret=_PLACEHOLDER_JWT_SECRET,
        strava_token_key=_PLACEHOLDER_TOKEN_KEY,
        strava_token_keys="",
        trusted_hosts="",
    )


def test_production_rejects_placeholder_jwt_secret() -> None:
    with pytest.raises(ConfigError, match="SUPABASE_JWT_SECRET"):
        Settings(**_kwargs(app_env="production",
                           supabase_jwt_secret=_PLACEHOLDER_JWT_SECRET,
                           trusted_hosts="api.example.com"))


def test_production_rejects_placeholder_strava_token_key() -> None:
    with pytest.raises(ConfigError, match="STRAVA_TOKEN"):
        Settings(**_kwargs(app_env="production",
                           strava_token_keys="",
                           strava_token_key=_PLACEHOLDER_TOKEN_KEY,
                           trusted_hosts="api.example.com"))


def test_production_rejects_empty_trusted_hosts() -> None:
    with pytest.raises(ConfigError, match="TRUSTED_HOSTS"):
        Settings(**_kwargs(app_env="production",
                           trusted_hosts=""))


def test_staging_also_validates() -> None:
    with pytest.raises(ConfigError):
        Settings(**_kwargs(app_env="staging",
                           supabase_jwt_secret=_PLACEHOLDER_JWT_SECRET,
                           trusted_hosts="staging.example.com"))


def test_production_with_real_values_succeeds() -> None:
    Settings(**_kwargs(app_env="production",
                       supabase_jwt_secret="real-jwt-secret-value-32+chars-long",
                       strava_token_keys="1:" + ("z" * 40),
                       trusted_hosts="api.example.com,api2.example.com"))


def test_cors_origins_list_property() -> None:
    s = Settings(**_kwargs(cors_origins="https://a.com, https://b.com ,"))
    assert s.cors_origins_list == ["https://a.com", "https://b.com"]


def test_trusted_hosts_list_property() -> None:
    s = Settings(**_kwargs(app_env="production",
                           trusted_hosts="a.com,b.com",
                           supabase_jwt_secret="real-secret-value-32+chars-of-padding"))
    assert s.trusted_hosts_list == ["a.com", "b.com"]
