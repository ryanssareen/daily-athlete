from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from src.api import health, me
from src.config import get_settings
from src.observability import init_sentry


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    init_sentry()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="DA2 API",
        version="0.0.1",
        lifespan=lifespan,
        debug=settings.app_env == "development",
    )

    if settings.trusted_hosts_list:
        app.add_middleware(
            TrustedHostMiddleware,
            allowed_hosts=settings.trusted_hosts_list,
        )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        # Bearer-token auth, not cookies — credentials must stay false.
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["authorization", "content-type"],
    )

    app.include_router(health.router)
    app.include_router(me.router)
    return app


app = create_app()
