"""Memory API routes - conversations, preferences and manual fact entries."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from app.config.loader import AppContext
from app.memory import MemoryManager
from app.providers.embeddings import EmbeddingProviderError

router = APIRouter(prefix="/api/v1/memory", tags=["memory"])


def _get_memory(request: Request) -> MemoryManager:
    context: AppContext = request.app.state.app_context
    if context.memory is None or not context.memory.enabled:
        raise HTTPException(status_code=503, detail="Memory module is disabled.")
    return context.memory


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------


@router.get("/stats")
def get_stats(request: Request) -> dict[str, Any]:
    return _get_memory(request).get_stats()


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------


@router.get("/conversations")
def list_conversations(
    request: Request,
    persona_id: str = Query(default=""),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    memory = _get_memory(request)
    filter_persona = persona_id or None
    rows = memory.store.list_conversations(persona_id=filter_persona, limit=limit, offset=offset)
    total = memory.store.count_conversations(persona_id=filter_persona)
    return {"items": rows, "total": total, "limit": limit, "offset": offset}


@router.get("/conversations/{conversation_id}")
def get_conversation(request: Request, conversation_id: str) -> dict[str, Any]:
    memory = _get_memory(request)
    conv = memory.store.get_conversation(conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail=f"Conversation '{conversation_id}' not found.")
    messages = memory.store.list_messages(conversation_id)
    summaries = memory.store.list_summaries(conversation_id)
    return {"conversation": conv, "messages": messages, "summaries": summaries}


@router.delete("/conversations/{conversation_id}", status_code=204, response_class=Response)
def delete_conversation(request: Request, conversation_id: str) -> Response:
    memory = _get_memory(request)
    if not memory.store.delete_conversation(conversation_id):
        raise HTTPException(status_code=404, detail=f"Conversation '{conversation_id}' not found.")
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------


class PreferencePayload(BaseModel):
    value: Any = Field(...)


@router.get("/preferences")
def list_preferences(
    request: Request,
    persona_id: str = Query(default=""),
) -> dict[str, Any]:
    memory = _get_memory(request)
    rows = memory.store.list_preferences(persona_id=persona_id or None)
    return {"items": rows}


@router.put("/preferences/{key}")
def set_preference(
    request: Request,
    key: str,
    payload: PreferencePayload,
    persona_id: str = Query(default=""),
) -> dict[str, Any]:
    memory = _get_memory(request)
    memory.store.set_preference(key, payload.value, persona_id=persona_id)
    return {"key": key, "persona_id": persona_id, "value": payload.value}


@router.delete("/preferences/{key}", status_code=204, response_class=Response)
def delete_preference(
    request: Request,
    key: str,
    persona_id: str = Query(default=""),
) -> Response:
    memory = _get_memory(request)
    if not memory.store.delete_preference(key, persona_id=persona_id):
        raise HTTPException(status_code=404, detail=f"Preference '{key}' not found.")
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Memory entries (manual facts)
# ---------------------------------------------------------------------------


class MemoryEntryCreate(BaseModel):
    content: str = Field(min_length=1)
    persona_id: str = Field(default="")
    tags: list[str] = Field(default_factory=list)
    source: str = Field(default="manual")


class MemoryEntryUpdate(BaseModel):
    content: str | None = Field(default=None)
    tags: list[str] | None = Field(default=None)


def _embedding_http_error(exc: EmbeddingProviderError) -> HTTPException:
    return HTTPException(status_code=502, detail=f"Embedding provider failed: {exc}")


@router.get("/entries")
def list_memory_entries(
    request: Request,
    persona_id: str = Query(default=""),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    memory = _get_memory(request)
    rows = memory.store.list_memories(persona_id=persona_id or None, limit=limit, offset=offset)
    total = memory.store.count_memories()
    return {"items": rows, "total": total}


@router.post("/entries", status_code=201)
def create_memory_entry(request: Request, payload: MemoryEntryCreate) -> dict[str, Any]:
    memory = _get_memory(request)
    try:
        return memory.create_memory_entry(
            content=payload.content,
            persona_id=payload.persona_id,
            source=payload.source,
            tags=payload.tags,
        )
    except EmbeddingProviderError as exc:
        raise _embedding_http_error(exc) from exc


@router.put("/entries/{entry_id}")
def update_memory_entry(
    request: Request, entry_id: str, payload: MemoryEntryUpdate
) -> dict[str, Any]:
    memory = _get_memory(request)
    try:
        updated = memory.update_memory_entry(entry_id, content=payload.content, tags=payload.tags)
    except EmbeddingProviderError as exc:
        raise _embedding_http_error(exc) from exc
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Memory entry '{entry_id}' not found.")
    return updated


@router.delete("/entries/{entry_id}", status_code=204, response_class=Response)
def delete_memory_entry(request: Request, entry_id: str) -> Response:
    memory = _get_memory(request)
    if not memory.delete_memory_entry(entry_id):
        raise HTTPException(status_code=404, detail=f"Memory entry '{entry_id}' not found.")
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Semantic search / indexing
# ---------------------------------------------------------------------------


@router.post("/entries/{entry_id}/index")
def index_memory_entry(request: Request, entry_id: str) -> dict[str, Any]:
    memory = _get_memory(request)
    if memory.store.get_memory(entry_id) is None:
        raise HTTPException(status_code=404, detail=f"Memory entry '{entry_id}' not found.")
    try:
        result = memory.index_memory(entry_id)
    except EmbeddingProviderError as exc:
        raise _embedding_http_error(exc) from exc
    if result is None:
        raise HTTPException(status_code=503, detail="Embedding provider is not configured.")
    return result


@router.post("/index")
def index_memory_entries(
    request: Request,
    persona_id: str = Query(default=""),
) -> dict[str, int]:
    memory = _get_memory(request)
    try:
        return memory.index_memories(persona_id=persona_id or None)
    except EmbeddingProviderError as exc:
        raise _embedding_http_error(exc) from exc


@router.get("/search")
def search_memory_entries(
    request: Request,
    query: str = Query(min_length=1),
    persona_id: str = Query(default=""),
    limit: int = Query(default=5, ge=1, le=20),
    min_score: float = Query(default=0.05, ge=-1.0, le=1.0),
) -> dict[str, Any]:
    memory = _get_memory(request)
    try:
        items = memory.search_relevant_memories(
            query,
            persona_id=persona_id,
            limit=limit,
            min_score=min_score,
        )
    except EmbeddingProviderError as exc:
        raise _embedding_http_error(exc) from exc
    return {
        "query": query,
        "persona_id": persona_id,
        "items": items,
        "total": len(items),
    }
