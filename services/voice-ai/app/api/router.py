from fastapi import APIRouter

from app.api.routes.config import router as config_router
from app.api.routes.conversation import router as conversation_router
from app.api.routes.health import router as health_router
from app.api.routes.memory import router as memory_router
from app.dashboard.router import router as dashboard_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(config_router)
api_router.include_router(conversation_router)
api_router.include_router(memory_router)
api_router.include_router(dashboard_router)
