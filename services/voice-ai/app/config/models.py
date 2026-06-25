from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


VoiceModeName = Literal["push_to_talk", "voice_activity", "continuous_conversation"]
PlaybackModeName = Literal["stream", "batch"]
MemoryScopeName = Literal["persona", "shared", "session"]
MemoryRetentionModeName = Literal["full_transcript", "summary_only", "transcript_and_summary"]
ToolAvailabilityName = Literal["disabled", "future", "enabled"]


class StrictConfigModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class ServiceConfig(StrictConfigModel):
    name: str = "deep-space-voice"
    version: str = "0.1.0"


class ApiConfig(StrictConfigModel):
    base_path: str = "/api/v1"
    cors_origins: list[str] = Field(default_factory=lambda: ["*"])


class RuntimeConfig(StrictConfigModel):
    log_level: str = "INFO"
    debug_audio_capture: bool = False


class FeaturesConfig(StrictConfigModel):
    prepared_modules: list[str] = Field(
        default_factory=lambda: [
            "api",
            "config",
            "providers",
            "conversation",
            "personas",
            "memory",
            "audio",
            "logs",
            "dashboard",
        ]
    )


class PresetSourcesConfig(StrictConfigModel):
    providers: str = "providers.json"
    personas: str = "personas.json"
    voice: str = "voice.json"


class MemoryConfig(StrictConfigModel):
    enabled: bool = True
    db_path: str = "data/memory.db"


class AppManifestConfig(StrictConfigModel):
    service: ServiceConfig = Field(default_factory=ServiceConfig)
    api: ApiConfig = Field(default_factory=ApiConfig)
    runtime: RuntimeConfig = Field(default_factory=RuntimeConfig)
    features: FeaturesConfig = Field(default_factory=FeaturesConfig)
    memory: MemoryConfig = Field(default_factory=MemoryConfig)
    preset_sources: PresetSourcesConfig = Field(default_factory=PresetSourcesConfig)


class ProviderConnectionConfig(StrictConfigModel):
    enabled: bool = True
    kind: str = Field(min_length=1)
    endpoint: str = ""
    model: str = ""
    api_key_env: str = ""
    timeout_seconds: int = Field(default=30, ge=1, le=600)
    options: dict[str, Any] = Field(default_factory=dict)


class EngineConnectionConfig(StrictConfigModel):
    enabled: bool = True
    backend: str = Field(min_length=1)
    endpoint: str = ""
    model: str = ""
    api_key_env: str = ""
    language: str = ""
    stream: bool = False
    options: dict[str, Any] = Field(default_factory=dict)


class LlmProvidersConfig(StrictConfigModel):
    providers: dict[str, ProviderConnectionConfig] = Field(default_factory=dict)
    default_provider: str = ""
    fallback_provider: str = ""

    @field_validator("default_provider")
    @classmethod
    def validate_default_provider(cls, value: str, info) -> str:
        providers = info.data.get("providers", {})
        if value and value not in providers:
            raise ValueError(f"default_provider must reference one of: {', '.join(providers) or '<none>'}")
        return value

    @field_validator("fallback_provider")
    @classmethod
    def validate_fallback_provider(cls, value: str, info) -> str:
        providers = info.data.get("providers", {})
        default_provider = info.data.get("default_provider", "")
        if value and value not in providers:
            raise ValueError(f"fallback_provider must reference one of: {', '.join(providers) or '<none>'}")
        if value and default_provider and value == default_provider:
            raise ValueError("fallback_provider must be different from default_provider")
        return value


class SttProvidersConfig(StrictConfigModel):
    engines: dict[str, EngineConnectionConfig] = Field(default_factory=dict)
    default_engine: str = "faster-whisper"

    @field_validator("default_engine")
    @classmethod
    def validate_default_engine(cls, value: str, info) -> str:
        engines = info.data.get("engines", {})
        if value and value not in engines:
            raise ValueError(f"default_engine must reference one of: {', '.join(engines) or '<none>'}")
        return value


class TtsProvidersConfig(StrictConfigModel):
    engines: dict[str, EngineConnectionConfig] = Field(default_factory=dict)
    default_engine: str = ""

    @field_validator("default_engine")
    @classmethod
    def validate_default_engine(cls, value: str, info) -> str:
        engines = info.data.get("engines", {})
        if value and value not in engines:
            raise ValueError(f"default_engine must reference one of: {', '.join(engines) or '<none>'}")
        return value


class EmbeddingsProvidersConfig(StrictConfigModel):
    providers: dict[str, ProviderConnectionConfig] = Field(default_factory=dict)
    default_provider: str = ""

    @field_validator("default_provider")
    @classmethod
    def validate_default_provider(cls, value: str, info) -> str:
        providers = info.data.get("providers", {})
        if value and value not in providers:
            raise ValueError(f"default_provider must reference one of: {', '.join(providers) or '<none>'}")
        return value


class ProvidersConfig(StrictConfigModel):
    llm: LlmProvidersConfig = Field(default_factory=LlmProvidersConfig)
    stt: SttProvidersConfig = Field(default_factory=SttProvidersConfig)
    tts: TtsProvidersConfig = Field(default_factory=TtsProvidersConfig)
    embeddings: EmbeddingsProvidersConfig = Field(default_factory=EmbeddingsProvidersConfig)


class PersonaPromptConfig(StrictConfigModel):
    system: str = ""
    role: str = ""
    context: str = ""
    tone_rules: list[str] = Field(default_factory=list)
    behavior_limits: list[str] = Field(default_factory=list)
    allowed_capabilities: list[str] = Field(default_factory=list)
    forbidden_capabilities: list[str] = Field(default_factory=list)


class PersonaStyleConfig(StrictConfigModel):
    tone: str = ""
    archetype: str = ""
    cadence: str = ""
    emotional_register: list[str] = Field(default_factory=list)
    vocabulary: list[str] = Field(default_factory=list)
    interaction_style: list[str] = Field(default_factory=list)


class PersonaVoiceConfig(StrictConfigModel):
    engine: str = ""
    fallback_engine: str = ""
    voice_id: str = ""
    style: str = ""
    language: str = "en"
    playback_mode: PlaybackModeName = "stream"
    speaking_rate: float = Field(default=1.0, ge=0.5, le=2.0)
    pitch: float = Field(default=0.0, ge=-1.0, le=1.0)
    expressive_presets: list[str] = Field(default_factory=list)


class PersonaMemoryConfig(StrictConfigModel):
    scope: MemoryScopeName = "persona"
    retention_mode: MemoryRetentionModeName = "transcript_and_summary"
    inject_relevant_memories: bool = True
    allow_user_preferences: bool = True
    notes: str = ""


class PersonaToolsConfig(StrictConfigModel):
    mode: ToolAvailabilityName = "future"
    allowed_tools: list[str] = Field(default_factory=list)
    blocked_tools: list[str] = Field(default_factory=list)
    notes: str = ""


class PersonaConfig(StrictConfigModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    preferred_language: str = "en"
    improvisation: float = Field(default=0.5, ge=0, le=1)
    prompts: PersonaPromptConfig = Field(default_factory=PersonaPromptConfig)
    style: PersonaStyleConfig = Field(default_factory=PersonaStyleConfig)
    voice: PersonaVoiceConfig = Field(default_factory=PersonaVoiceConfig)
    memory: PersonaMemoryConfig = Field(default_factory=PersonaMemoryConfig)
    tools: PersonaToolsConfig = Field(default_factory=PersonaToolsConfig)

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        for item in value:
            tag = item.strip()
            if not tag:
                raise ValueError("tags must not contain empty values")
            if tag not in normalized:
                normalized.append(tag)
        return normalized


class PersonasConfig(StrictConfigModel):
    personas: list[PersonaConfig] = Field(default_factory=list)
    default_persona_id: str = ""

    @field_validator("personas")
    @classmethod
    def validate_unique_ids(cls, value: list[PersonaConfig]) -> list[PersonaConfig]:
        ids = [persona.id for persona in value]
        duplicates = sorted({identifier for identifier in ids if ids.count(identifier) > 1})
        if duplicates:
            raise ValueError(f"persona ids must be unique; duplicates: {', '.join(duplicates)}")
        return value

    @field_validator("default_persona_id")
    @classmethod
    def validate_default_persona_id(cls, value: str, info) -> str:
        personas = info.data.get("personas", [])
        persona_ids = {persona.id for persona in personas}
        if value and value not in persona_ids:
            raise ValueError(f"default_persona_id must reference one of: {', '.join(sorted(persona_ids)) or '<none>'}")
        return value


class WakeWordConfig(StrictConfigModel):
    enabled: bool = True
    phrase: str = Field(min_length=1)
    sensitivity: float = Field(default=0.5, ge=0, le=1)
    provider_engine: str = ""


class VadConfig(StrictConfigModel):
    enabled: bool = True
    threshold: float = Field(default=0.018, ge=0, le=1)
    min_speech_ms: int = Field(default=220, ge=0, le=10_000)
    min_silence_ms: int = Field(default=700, ge=0, le=30_000)
    fallback_min_bytes: int = Field(default=600, ge=1, le=1_000_000)


class VoiceModesConfig(StrictConfigModel):
    available_modes: list[VoiceModeName] = Field(default_factory=lambda: ["push_to_talk"])
    default_mode: VoiceModeName = "push_to_talk"
    allow_barge_in: bool = True
    vad_enabled: bool = False
    vad: VadConfig = Field(default_factory=VadConfig)
    continuous_requires_wake_word: bool = True
    continuous_idle_timeout_seconds: int = Field(default=45, ge=1, le=3600)
    auto_listen_after_response: bool = True

    @field_validator("available_modes")
    @classmethod
    def validate_available_modes(cls, value: list[VoiceModeName]) -> list[VoiceModeName]:
        if not value:
            raise ValueError("available_modes must contain at least one mode")
        ordered_unique = list(dict.fromkeys(value))
        if len(ordered_unique) != len(value):
            raise ValueError("available_modes must not contain duplicates")
        return value

    @field_validator("default_mode")
    @classmethod
    def validate_default_mode(cls, value: VoiceModeName, info) -> VoiceModeName:
        available_modes = info.data.get("available_modes", [])
        if value not in available_modes:
            raise ValueError(f"default_mode must be one of: {', '.join(available_modes) or '<none>'}")
        return value


class VoiceConfig(StrictConfigModel):
    supported_languages: list[str] = Field(default_factory=lambda: ["fr", "en"])
    wake_word: WakeWordConfig = Field(default_factory=lambda: WakeWordConfig(phrase="eternity"))
    modes: VoiceModesConfig = Field(default_factory=VoiceModesConfig)

    @field_validator("supported_languages")
    @classmethod
    def validate_supported_languages(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("supported_languages must contain at least one language")
        normalized = [language.strip().lower() for language in value]
        if any(not language for language in normalized):
            raise ValueError("supported_languages must not contain empty values")
        if len(set(normalized)) != len(normalized):
            raise ValueError("supported_languages must not contain duplicates")
        return normalized


class AppConfig(StrictConfigModel):
    service: ServiceConfig = Field(default_factory=ServiceConfig)
    api: ApiConfig = Field(default_factory=ApiConfig)
    runtime: RuntimeConfig = Field(default_factory=RuntimeConfig)
    features: FeaturesConfig = Field(default_factory=FeaturesConfig)
    memory: MemoryConfig = Field(default_factory=MemoryConfig)
    providers: ProvidersConfig = Field(default_factory=ProvidersConfig)
    personas: PersonasConfig = Field(default_factory=PersonasConfig)
    voice: VoiceConfig = Field(default_factory=VoiceConfig)

    @model_validator(mode="after")
    def validate_cross_references(self) -> "AppConfig":
        supported_languages = set(self.voice.supported_languages)

        for persona in self.personas.personas:
            if persona.preferred_language.lower() not in supported_languages:
                raise ValueError(
                    f"persona '{persona.id}' preferred_language '{persona.preferred_language}' "
                    "must be present in voice.supported_languages"
                )
            if persona.voice.language.lower() not in supported_languages:
                raise ValueError(
                    f"persona '{persona.id}' voice.language '{persona.voice.language}' "
                    "must be present in voice.supported_languages"
                )
            if persona.voice.engine and persona.voice.engine not in self.providers.tts.engines:
                raise ValueError(
                    f"persona '{persona.id}' voice.engine '{persona.voice.engine}' must reference "
                    "a configured TTS engine"
                )
            if persona.voice.fallback_engine and persona.voice.fallback_engine not in self.providers.tts.engines:
                raise ValueError(
                    f"persona '{persona.id}' voice.fallback_engine '{persona.voice.fallback_engine}' must reference "
                    "a configured TTS engine"
                )

        if self.voice.wake_word.provider_engine and self.voice.wake_word.provider_engine not in self.providers.stt.engines:
            raise ValueError(
                f"voice.wake_word.provider_engine '{self.voice.wake_word.provider_engine}' must reference "
                "a configured STT engine"
            )

        return self
