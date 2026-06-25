from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.config.loader import build_app_context
from app.logs.logging import configure_logging


_DASHBOARD_STATIC_DIR = Path(__file__).resolve().parent / "dashboard" / "static"


def _load_context(application: FastAPI) -> None:
    context = build_app_context()
    configure_logging(context.settings.log_level)
    application.state.app_context = context
    application.title = context.config.service.name
    application.version = context.config.service.version


@asynccontextmanager
async def lifespan(application: FastAPI):
    _load_context(application)
    yield


def create_app() -> FastAPI:
    application = FastAPI(
        title="deep-space-voice",
        version="0.1.0",
        description="FastAPI service scaffold for the Deep Space VR voice assistant.",
        lifespan=lifespan,
    )
    _load_context(application)
    # CORS is read once at startup so the VR app (and other clients) can call the
    # service cross-origin. Changing api.cors_origins from the dashboard requires a restart.
    application.add_middleware(
        CORSMiddleware,
        allow_origins=application.state.app_context.config.api.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.mount("/dashboard/assets", StaticFiles(directory=_DASHBOARD_STATIC_DIR), name="dashboard-assets")
    application.include_router(api_router)
    return application


app = create_app()
