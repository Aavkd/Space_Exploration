from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from app.audio import ContinuousConversationState
from app.conversation import ConversationOrchestrator, VoicePipelineOrchestrator
from app.config.models import (
    AppConfig,
    AppManifestConfig,
    PersonasConfig,
    ProvidersConfig,
    VoiceConfig,
)
from app.config.settings import AppSettings
from app.memory import MemoryManager
from app.providers.embeddings import EmbeddingsGateway
from app.providers.llm import LlmGateway
from app.providers.stt import SttGateway
from app.providers.tts import TtsGateway


ModelT = TypeVar("ModelT", bound=BaseModel)


class ConfigValidationError(ValueError):
    """Raised when a JSON preset cannot be validated."""


@dataclass(slots=True)
class PresetPaths:
    manifest: Path
    providers: Path
    personas: Path
    voice: Path


@dataclass(slots=True)
class ConfigStore:
    paths: PresetPaths

    @classmethod
    def from_manifest_path(cls, manifest_path: Path) -> "ConfigStore":
        manifest = load_preset_file(manifest_path, AppManifestConfig, "application manifest")
        base_dir = manifest_path.resolve().parent
        return cls(
            paths=PresetPaths(
                manifest=manifest_path.resolve(),
                providers=resolve_config_path(base_dir, manifest.preset_sources.providers),
                personas=resolve_config_path(base_dir, manifest.preset_sources.personas),
                voice=resolve_config_path(base_dir, manifest.preset_sources.voice),
            )
        )

    def load_manifest(self) -> AppManifestConfig:
        return load_preset_file(self.paths.manifest, AppManifestConfig, "application manifest")

    def save_manifest(self, config: AppManifestConfig) -> Path:
        return save_preset_file(self.paths.manifest, config)

    def load_app_config(self) -> AppConfig:
        manifest = self.load_manifest()
        providers = self.load_providers()
        personas = self.load_personas()
        voice = self.load_voice()
        return compose_app_config(
            manifest=manifest,
            providers=providers,
            personas=personas,
            voice=voice,
            error_path=self.paths.manifest,
        )

    def load_providers(self) -> ProvidersConfig:
        return load_preset_file(self.paths.providers, ProvidersConfig, "providers preset")

    def save_providers(self, config: ProvidersConfig) -> Path:
        return save_preset_file(self.paths.providers, config)

    def load_personas(self) -> PersonasConfig:
        return load_preset_file(self.paths.personas, PersonasConfig, "personas preset")

    def save_personas(self, config: PersonasConfig) -> Path:
        return save_preset_file(self.paths.personas, config)

    def load_voice(self) -> VoiceConfig:
        return load_preset_file(self.paths.voice, VoiceConfig, "voice preset")

    def save_voice(self, config: VoiceConfig) -> Path:
        return save_preset_file(self.paths.voice, config)


@dataclass(slots=True)
class AppContext:
    settings: AppSettings
    config: AppConfig
    store: ConfigStore
    conversation: ConversationOrchestrator
    pipeline: VoicePipelineOrchestrator
    stt: SttGateway
    tts: TtsGateway
    memory: MemoryManager | None
    voice_sessions: ContinuousConversationState


def resolve_config_path(base_dir: Path, value: str | Path) -> Path:
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = base_dir / candidate
    return candidate.resolve()


def read_json_file(file_path: Path) -> dict:
    if not file_path.exists():
        raise FileNotFoundError(f"Configuration file not found: {file_path}")

    with file_path.open("r", encoding="utf-8") as file:
        try:
            return json.load(file)
        except json.JSONDecodeError as exc:
            raise ConfigValidationError(f"Invalid JSON in configuration file {file_path}: {exc.msg} (line {exc.lineno}, column {exc.colno})") from exc


def load_preset_file(file_path: Path, model_type: type[ModelT], label: str) -> ModelT:
    raw_config = read_json_file(file_path)

    try:
        return model_type.model_validate(raw_config)
    except ValidationError as exc:
        raise ConfigValidationError(format_validation_error(label, file_path, exc)) from exc


def save_preset_file(file_path: Path, config: BaseModel) -> Path:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with file_path.open("w", encoding="utf-8") as file:
        json.dump(config.model_dump(mode="json"), file, indent=2, ensure_ascii=True)
        file.write("\n")
    return file_path


def format_validation_error(label: str, file_path: Path, exc: ValidationError) -> str:
    lines = [f"Invalid {label} at {file_path}:"]
    for error in exc.errors(include_url=False):
        location = ".".join(str(part) for part in error.get("loc", ())) or "<root>"
        lines.append(f"- {location}: {error.get('msg', 'Invalid value')}")
    return "\n".join(lines)


def load_app_config(config_path: Path) -> AppConfig:
    store = ConfigStore.from_manifest_path(config_path)
    return store.load_app_config()


def compose_app_config(
    *,
    manifest: AppManifestConfig,
    providers: ProvidersConfig,
    personas: PersonasConfig,
    voice: VoiceConfig,
    error_path: Path,
) -> AppConfig:
    try:
        return AppConfig(
            service=manifest.service,
            api=manifest.api,
            runtime=manifest.runtime,
            features=manifest.features,
            memory=manifest.memory,
            providers=providers,
            personas=personas,
            voice=voice,
        )
    except ValidationError as exc:
        raise ConfigValidationError(format_validation_error("application configuration", error_path, exc)) from exc


def build_app_context() -> AppContext:
    settings = AppSettings()
    store = ConfigStore.from_manifest_path(settings.config_file)
    config = store.load_app_config()
    memory = build_memory_manager(config, manifest_dir=store.paths.manifest.parent)
    conversation = build_conversation_orchestrator(config, memory=memory)
    stt = build_stt_gateway(config)
    tts = build_tts_gateway(config, manifest_dir=store.paths.manifest.parent)
    return AppContext(
        settings=settings,
        config=config,
        store=store,
        conversation=conversation,
        pipeline=VoicePipelineOrchestrator(conversation, stt, tts),
        stt=stt,
        tts=tts,
        memory=memory,
        voice_sessions=ContinuousConversationState(config.voice),
    )


def build_memory_manager(config: AppConfig, *, manifest_dir: Path) -> MemoryManager | None:
    if not config.memory.enabled:
        return None
    raw_path = Path(config.memory.db_path)
    db_path = raw_path if raw_path.is_absolute() else manifest_dir / raw_path
    return MemoryManager.from_db_path(
        db_path,
        enabled=True,
        embeddings=EmbeddingsGateway(config.providers.embeddings),
    )


def build_conversation_orchestrator(
    config: AppConfig, *, memory: MemoryManager | None = None
) -> ConversationOrchestrator:
    return ConversationOrchestrator(
        default_persona_id=config.personas.default_persona_id,
        personas=config.personas.personas,
        llm_gateway=LlmGateway(config.providers.llm),
        memory=memory,
    )


def build_stt_gateway(config: AppConfig) -> SttGateway:
    return SttGateway(
        config.providers.stt,
        supported_languages=config.voice.supported_languages,
        debug_audio_capture=config.runtime.debug_audio_capture,
    )


def build_tts_gateway(config: AppConfig, *, manifest_dir: Path) -> TtsGateway:
    """Build the TTS gateway, resolving any relative model paths against manifest_dir.

    This mirrors the pattern used for ``memory.db_path`` so that a relative
    ``options.model_path`` in providers.json works correctly regardless of the
    process CWD (e.g. native Windows vs. inside Docker at /app).
    """
    for engine_cfg in config.providers.tts.engines.values():
        if engine_cfg.backend == "piper" and "model_path" in engine_cfg.options:
            raw = engine_cfg.options["model_path"]
            p = Path(raw)
            if not p.is_absolute():
                engine_cfg.options["model_path"] = str((manifest_dir / p).resolve())
    return TtsGateway(config.providers.tts)
