from fastapi import APIRouter, Request

from app.config.loader import AppContext

router = APIRouter(tags=["health"])


def _build_health_payload(context: AppContext) -> dict:
    return {
        "status": "ok",
        "service": context.config.service.name,
        "version": context.config.service.version,
        "environment": context.settings.environment,
        "modules": context.config.features.prepared_modules,
    }


@router.get("/")
def root(request: Request) -> dict:
    context: AppContext = request.app.state.app_context
    return {
        "message": "deep-space-voice service is ready",
        "dashboard": "/dashboard",
        "health": "/health",
        "api_health": f"{context.config.api.base_path}/health",
    }


@router.get("/health")
def health(request: Request) -> dict:
    context: AppContext = request.app.state.app_context
    return _build_health_payload(context)


@router.get("/api/v1/health")
def api_health(request: Request) -> dict:
    context: AppContext = request.app.state.app_context
    return _build_health_payload(context)
