from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

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
    app.include_router(health.router)
    app.include_router(me.router)
    return app


app = create_app()
