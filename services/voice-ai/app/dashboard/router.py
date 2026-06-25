from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse


router = APIRouter(tags=["dashboard"])

_VALID_PAGES = {
    "overview",
    "settings",
    "providers",
    "personas",
    "conversation-test",
    "voice-stt-tts",
    "memory",
    "logs",
}

_STATIC_DIR = Path(__file__).resolve().parent / "static"
_INDEX_FILE = _STATIC_DIR / "index.html"


@router.get("/dashboard")
def dashboard_index() -> FileResponse:
    return FileResponse(_INDEX_FILE)


@router.get("/dashboard/{page_name}")
def dashboard_page(page_name: str) -> FileResponse:
    if page_name not in _VALID_PAGES:
        raise HTTPException(status_code=404, detail="Dashboard page not found")
    return FileResponse(_INDEX_FILE)
