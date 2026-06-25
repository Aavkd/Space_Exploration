from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app.audio import ContinuousConversationState
from app.config.loader import (
    AppContext,
    ConfigValidationError,
    build_conversation_orchestrator,
    build_memory_manager,
    build_stt_gateway,
    build_tts_gateway,
    compose_app_config,
)
from app.config.models import AppManifestConfig, PersonasConfig, ProvidersConfig, VoiceConfig
from app.conversation import VoicePipelineOrchestrator
from app.logs.logging import configure_logging
from app.providers.embeddings import EmbeddingsGateway


router = APIRouter(tags=["config"])


def _get_context(request: Request) -> AppContext:
    return request.app.state.app_context


def _refresh_context(request: Request) -> AppContext:
    context = _get_context(request)
    reloaded_config = context.store.load_app_config()
    configure_logging(reloaded_config.runtime.log_level)
    context.config = reloaded_config
    # Memory manager keeps its SQLite connection across reloads; only rebuild if config changed.
    if context.memory is None and reloaded_config.memory.enabled:
        context.memory = build_memory_manager(
            reloaded_config, manifest_dir=context.store.paths.manifest.parent
        )
    elif context.memory is not None:
        context.memory.enabled = reloaded_config.memory.enabled
        context.memory.embeddings = EmbeddingsGateway(reloaded_config.providers.embeddings)
    context.conversation = build_conversation_orchestrator(reloaded_config, memory=context.memory)
    context.stt = build_stt_gateway(reloaded_config)
    context.tts = build_tts_gateway(reloaded_config, manifest_dir=context.store.paths.manifest.parent)
    context.pipeline = VoicePipelineOrchestrator(context.conversation, context.stt, context.tts)
    context.voice_sessions = ContinuousConversationState(reloaded_config.voice)
    request.app.state.app_context = context
    request.app.title = reloaded_config.service.name
    request.app.version = reloaded_config.service.version
    return context


def _validate_configuration(
    request: Request,
    *,
    manifest: AppManifestConfig | None = None,
    providers: ProvidersConfig | None = None,
    personas: PersonasConfig | None = None,
    voice: VoiceConfig | None = None,
) -> None:
    context = _get_context(request)
    store = context.store
    active_manifest = manifest or store.load_manifest()
    active_providers = providers or store.load_providers()
    active_personas = personas or store.load_personas()
    active_voice = voice or store.load_voice()
    compose_app_config(
        manifest=active_manifest,
        providers=active_providers,
        personas=active_personas,
        voice=active_voice,
        error_path=store.paths.manifest,
    )


def _build_overview_payload(context: AppContext) -> dict[str, Any]:
    config = context.config
    store = context.store
    return {
        "service": {
            "name": config.service.name,
            "version": config.service.version,
            "environment": context.settings.environment,
            "log_level": config.runtime.log_level,
        },
        "counts": {
            "llm_providers": len(config.providers.llm.providers),
            "stt_engines": len(config.providers.stt.engines),
            "tts_engines": len(config.providers.tts.engines),
            "embedding_providers": len(config.providers.embeddings.providers),
            "personas": len(config.personas.personas),
            "voice_modes": len(config.voice.modes.available_modes),
        },
        "defaults": {
            "llm_provider": config.providers.llm.default_provider,
            "llm_fallback": config.providers.llm.fallback_provider,
            "stt_engine": config.providers.stt.default_engine,
            "tts_engine": config.providers.tts.default_engine,
            "embeddings_provider": config.providers.embeddings.default_provider,
            "persona_id": config.personas.default_persona_id,
            "voice_mode": config.voice.modes.default_mode,
            "wake_word": config.voice.wake_word.phrase,
            "vad_threshold": config.voice.modes.vad.threshold,
        },
        "paths": {
            "manifest": str(store.paths.manifest),
            "providers": str(store.paths.providers),
            "personas": str(store.paths.personas),
            "voice": str(store.paths.voice),
        },
        "supported_languages": config.voice.supported_languages,
        "modules": config.features.prepared_modules,
        "pages": [
            "overview",
            "settings",
            "providers",
            "personas",
            "conversation-test",
            "voice-stt-tts",
            "memory",
            "logs",
        ],
        "memory": {
            "enabled": context.config.memory.enabled,
            "db_path": context.config.memory.db_path,
        },
        "roadmap_notes": {
            "conversation_test": "The dashboard now runs live text conversations, captures browser microphone audio, exposes dry run prompts, and includes the Lot 12 continuous conversation prototype.",
            "memory": "SQLite memory is live. Conversations, preferences and manual facts are persisted and editable from this page.",
            "logs": "Operational log streaming arrives in Lot 14. The page already reflects runtime logging settings.",
        },
    }


@router.get("/api/v1/config")
def get_config(request: Request) -> dict[str, Any]:
    return _get_context(request).config.model_dump(mode="json")


@router.get("/api/v1/config/manifest")
def get_manifest(request: Request) -> dict[str, Any]:
    return _get_context(request).store.load_manifest().model_dump(mode="json")


@router.put("/api/v1/config/manifest")
def update_manifest(request: Request, payload: AppManifestConfig) -> dict[str, Any]:
    context = _get_context(request)
    current_manifest = context.store.load_manifest()
    if payload.preset_sources != current_manifest.preset_sources:
        raise HTTPException(
            status_code=400,
            detail="preset_sources cannot be changed from the dashboard in V1; update files manually if you need a new config layout.",
        )

    try:
        _validate_configuration(request, manifest=payload)
    except ConfigValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    context.store.save_manifest(payload)
    _refresh_context(request)
    return payload.model_dump(mode="json")


@router.get("/api/v1/config/providers")
def get_providers(request: Request) -> dict[str, Any]:
    return _get_context(request).store.load_providers().model_dump(mode="json")


@router.put("/api/v1/config/providers")
def update_providers(request: Request, payload: ProvidersConfig) -> dict[str, Any]:
    context = _get_context(request)
    try:
        _validate_configuration(request, providers=payload)
    except ConfigValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    context.store.save_providers(payload)
    _refresh_context(request)
    return payload.model_dump(mode="json")


@router.get("/api/v1/config/personas")
def get_personas(request: Request) -> dict[str, Any]:
    return _get_context(request).store.load_personas().model_dump(mode="json")


@router.put("/api/v1/config/personas")
def update_personas(request: Request, payload: PersonasConfig) -> dict[str, Any]:
    context = _get_context(request)
    try:
        _validate_configuration(request, personas=payload)
    except ConfigValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    context.store.save_personas(payload)
    _refresh_context(request)
    return payload.model_dump(mode="json")


@router.get("/api/v1/config/voice")
def get_voice(request: Request) -> dict[str, Any]:
    return _get_context(request).store.load_voice().model_dump(mode="json")


@router.put("/api/v1/config/voice")
def update_voice(request: Request, payload: VoiceConfig) -> dict[str, Any]:
    context = _get_context(request)
    try:
        _validate_configuration(request, voice=payload)
    except ConfigValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    context.store.save_voice(payload)
    _refresh_context(request)
    return payload.model_dump(mode="json")


@router.get("/api/v1/dashboard/overview")
def get_dashboard_overview(request: Request) -> dict[str, Any]:
    context = _refresh_context(request)
    return _build_overview_payload(context)
