"""Conversation orchestration package."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.config.models import PersonaConfig
from app.providers.llm import LlmExecutionResult, LlmGateway
from app.providers.stt import SttGateway
from app.providers.tts import TtsGateway

if TYPE_CHECKING:
    from app.memory import MemoryManager


# ---------------------------------------------------------------------------
# Pipeline interrupt tracking (module-level, GIL-safe in CPython)
# ---------------------------------------------------------------------------

_cancelled_sessions: set[str] = set()


class PipelineInterruptedError(RuntimeError):
    """Raised when a voice pipeline session is cancelled between stages."""


def cancel_pipeline_session(session_id: str) -> None:
    """Mark a pipeline session as cancelled. The pipeline checks this between stages."""
    if session_id:
        _cancelled_sessions.add(session_id)


def clear_pipeline_session(session_id: str) -> None:
    """Remove cancellation state for a finished or cleaned-up session."""
    _cancelled_sessions.discard(session_id)


def _is_pipeline_cancelled(session_id: str) -> bool:
    return bool(session_id) and session_id in _cancelled_sessions


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class ConversationPersonaError(ValueError):
    """Raised when the requested persona cannot be resolved."""


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class ConversationTextResult:
    persona_id: str
    persona_name: str
    persona_language: str
    persona_snapshot: dict[str, object]
    input_text: str
    response_text: str
    prompt_final: str
    provider_id: str
    provider_kind: str
    model: str
    fallback_used: bool
    attempted_providers: list[str]
    injected_memories: list[dict[str, object]]
    prompt_build_duration_ms: float
    provider_duration_ms: float
    llm_total_duration_ms: float
    total_duration_ms: float


@dataclass(slots=True)
class VoicePipelineResult:
    session_id: str
    persona_id: str
    persona_name: str
    # STT stage
    transcript: str
    stt_language: str
    stt_language_probability: float
    stt_language_supported: bool
    stt_engine_id: str
    stt_engine_backend: str
    stt_model: str
    stt_duration_ms: float
    # LLM stage
    response_text: str
    prompt_final: str
    llm_provider_id: str
    llm_provider_kind: str
    llm_model: str
    llm_fallback_used: bool
    llm_attempted_providers: list[str]
    llm_injected_memories: list[dict[str, object]]
    llm_prompt_build_ms: float
    llm_duration_ms: float
    # TTS stage
    audio_bytes: bytes
    audio_content_type: str
    tts_engine_id: str
    tts_engine_backend: str
    tts_voice_id: str
    tts_duration_ms: float
    # Overall
    dry_run: bool
    stt_ms: float
    llm_ms: float
    tts_ms: float
    total_ms: float


# ---------------------------------------------------------------------------
# Orchestrators
# ---------------------------------------------------------------------------


class ConversationOrchestrator:
    """Text-first conversation orchestration with persona-aware prompt assembly."""

    def __init__(
        self,
        default_persona_id: str,
        personas: list[PersonaConfig],
        llm_gateway: LlmGateway,
        memory: "MemoryManager | None" = None,
    ) -> None:
        self.default_persona_id = default_persona_id
        self.llm_gateway = llm_gateway
        self.memory = memory
        self._personas_by_id = {persona.id: persona for persona in personas}

    def resolve_persona(self, persona_id: str) -> PersonaConfig:
        """Resolve a persona by ID, falling back to the configured default."""
        active_persona_id = persona_id.strip() or self.default_persona_id
        if not active_persona_id:
            raise ConversationPersonaError("No active persona is configured.")

        persona = self._personas_by_id.get(active_persona_id)
        if persona is None:
            available = ", ".join(sorted(self._personas_by_id)) or "<none>"
            raise ConversationPersonaError(
                f"Persona '{active_persona_id}' is not declared. Available personas: {available}"
            )
        return persona

    # Internal alias kept so nothing breaks if subclasses call it.
    _resolve_persona = resolve_persona

    def submit_text(
        self,
        message: str,
        *,
        provider_id: str = "",
        persona_id: str = "",
        session_id: str = "",
    ) -> ConversationTextResult:
        started_at = time.perf_counter()
        persona = self.resolve_persona(persona_id)

        prompt_started_at = time.perf_counter()
        relevant_memories = self._resolve_relevant_memories(persona, message.strip())
        prompt_final = self._build_prompt(persona, message.strip(), relevant_memories=relevant_memories)
        prompt_build_duration_ms = (time.perf_counter() - prompt_started_at) * 1000

        llm_result: LlmExecutionResult = self.llm_gateway.generate_text(prompt_final, provider_id=provider_id)
        total_duration_ms = (time.perf_counter() - started_at) * 1000

        if self.memory is not None:
            self.memory.persist_conversation_turn(
                user_message=message.strip(),
                assistant_response=llm_result.text,
                persona_id=persona.id,
                session_id=session_id,
                retention_mode=persona.memory.retention_mode,
                provider_id=llm_result.provider_id,
                model=llm_result.model,
                latency_ms=int(total_duration_ms),
            )

        return ConversationTextResult(
            persona_id=persona.id,
            persona_name=persona.name,
            persona_language=persona.preferred_language,
            persona_snapshot=persona.model_dump(mode="json"),
            input_text=message.strip(),
            response_text=llm_result.text,
            prompt_final=prompt_final,
            provider_id=llm_result.provider_id,
            provider_kind=llm_result.provider_kind,
            model=llm_result.model,
            fallback_used=llm_result.fallback_used,
            attempted_providers=llm_result.attempted_providers,
            injected_memories=relevant_memories,
            prompt_build_duration_ms=prompt_build_duration_ms,
            provider_duration_ms=llm_result.provider_duration_ms,
            llm_total_duration_ms=llm_result.total_duration_ms,
            total_duration_ms=total_duration_ms,
        )

    def _build_prompt(
        self,
        persona: PersonaConfig,
        message: str,
        *,
        relevant_memories: list[dict[str, object]] | None = None,
    ) -> str:
        prompts = persona.prompts
        sections = [
            self._format_section("SYSTEM", prompts.system),
            self._format_section("ROLE", prompts.role),
            self._format_section("CONTEXT", prompts.context),
            self._format_section("TONE RULES", self._format_list(prompts.tone_rules)),
            self._format_section("BEHAVIOR LIMITS", self._format_list(prompts.behavior_limits)),
            self._format_section("ALLOWED CAPABILITIES", self._format_list(prompts.allowed_capabilities)),
            self._format_section("FORBIDDEN CAPABILITIES", self._format_list(prompts.forbidden_capabilities)),
            self._format_section(
                "STYLE PROFILE",
                self._format_key_values(
                    [
                        ("Tone", persona.style.tone),
                        ("Archetype", persona.style.archetype),
                        ("Cadence", persona.style.cadence),
                        ("Emotional register", ", ".join(persona.style.emotional_register)),
                        ("Vocabulary anchors", ", ".join(persona.style.vocabulary)),
                        ("Interaction style", ", ".join(persona.style.interaction_style)),
                    ]
                ),
            ),
            self._format_section(
                "PERSONA PROFILE",
                self._format_key_values(
                    [
                        ("Name", persona.name),
                        ("Persona ID", persona.id),
                        ("Description", persona.description),
                        ("Tags", ", ".join(persona.tags)),
                        ("Preferred language", persona.preferred_language),
                        ("Improvisation", f"{persona.improvisation:.2f}"),
                    ]
                ),
            ),
            self._format_section(
                "VOICE PROFILE",
                self._format_key_values(
                    [
                        ("Primary engine", persona.voice.engine),
                        ("Fallback engine", persona.voice.fallback_engine),
                        ("Voice ID", persona.voice.voice_id),
                        ("Voice style", persona.voice.style or "default"),
                        ("Voice language", persona.voice.language),
                        ("Playback mode", persona.voice.playback_mode),
                        ("Speaking rate", f"{persona.voice.speaking_rate:.2f}"),
                        ("Pitch", f"{persona.voice.pitch:.2f}"),
                        ("Expressive presets", ", ".join(persona.voice.expressive_presets)),
                    ]
                ),
            ),
            self._format_section(
                "MEMORY POLICY",
                self._format_key_values(
                    [
                        ("Memory scope", persona.memory.scope),
                        ("Retention mode", persona.memory.retention_mode),
                        ("Inject relevant memories", "yes" if persona.memory.inject_relevant_memories else "no"),
                        ("Allow user preferences", "yes" if persona.memory.allow_user_preferences else "no"),
                        ("Memory notes", persona.memory.notes),
                    ]
                ),
            ),
            self._format_section("RELEVANT MEMORIES", self._format_memories(relevant_memories or [])),
            self._format_section(
                "TOOLS POLICY",
                self._format_key_values(
                    [
                        ("Tool availability", persona.tools.mode),
                        ("Allowed tools", ", ".join(persona.tools.allowed_tools)),
                        ("Blocked tools", ", ".join(persona.tools.blocked_tools)),
                        ("Tool notes", persona.tools.notes),
                    ]
                ),
            ),
            self._format_section("RESPONSE CONTRACT", "Answer the user directly while staying faithful to the active persona."),
            self._format_section("USER MESSAGE", message),
        ]
        return "\n\n".join(section for section in sections if section)

    def _resolve_relevant_memories(self, persona: PersonaConfig, message: str) -> list[dict[str, object]]:
        if (
            self.memory is None
            or not self.memory.enabled
            or not persona.memory.inject_relevant_memories
            or not message.strip()
        ):
            return []
        return self.memory.search_relevant_memories(message, persona_id=persona.id)

    @staticmethod
    def _format_list(items: list[str]) -> str:
        return "\n".join(f"- {item}" for item in items if item.strip())

    @staticmethod
    def _format_key_values(items: list[tuple[str, str]]) -> str:
        return "\n".join(f"{label}: {value}" for label, value in items if value.strip())

    @staticmethod
    def _format_memories(memories: list[dict[str, object]]) -> str:
        lines: list[str] = []
        for index, memory in enumerate(memories, start=1):
            content = str(memory.get("content", "")).strip()
            if not content:
                continue
            score = memory.get("score", 0)
            persona_id = str(memory.get("persona_id", "") or "global")
            source = str(memory.get("source", "") or "unknown")
            tags = memory.get("tags", [])
            tag_text = ", ".join(str(tag) for tag in tags) if isinstance(tags, list) else ""
            label = f"{index}. score={score} scope={persona_id} source={source}"
            if tag_text:
                label = f"{label} tags={tag_text}"
            lines.append(f"- {label}\n  {content}")
        return "\n".join(lines)

    @staticmethod
    def _format_section(title: str, content: str) -> str:
        normalized = content.strip()
        if not normalized:
            return ""
        return f"[{title}]\n{normalized}"


class VoicePipelineOrchestrator:
    """Full voice pipeline: audio → STT → LLM → TTS → audio.

    Checks for session cancellation between each stage so that an external
    interrupt request can halt the pipeline before the next stage begins.
    """

    def __init__(
        self,
        conversation: ConversationOrchestrator,
        stt: SttGateway,
        tts: TtsGateway,
    ) -> None:
        self.conversation = conversation
        self.stt = stt
        self.tts = tts

    def run_pipeline(
        self,
        audio_bytes: bytes,
        *,
        content_type: str = "audio/webm",
        filename: str = "pipeline-input.webm",
        persona_id: str = "",
        provider_id: str = "",
        stt_engine_id: str = "",
        tts_engine_id: str = "",
        session_id: str = "",
        dry_run: bool = False,
    ) -> VoicePipelineResult:
        started_at = time.perf_counter()
        persona = self.conversation.resolve_persona(persona_id)

        # --- STT stage ---
        if _is_pipeline_cancelled(session_id):
            clear_pipeline_session(session_id)
            raise PipelineInterruptedError(f"Session '{session_id}' cancelled before STT.")
        stt_t0 = time.perf_counter()
        stt_result = self.stt.transcribe_audio(
            audio_bytes,
            content_type=content_type,
            filename=filename,
            engine_id=stt_engine_id,
        )
        stt_ms = (time.perf_counter() - stt_t0) * 1000

        # --- LLM stage ---
        if _is_pipeline_cancelled(session_id):
            clear_pipeline_session(session_id)
            raise PipelineInterruptedError(f"Session '{session_id}' cancelled after STT.")
        llm_t0 = time.perf_counter()
        text_result = self.conversation.submit_text(
            stt_result.text,
            provider_id=provider_id,
            persona_id=persona.id,
            session_id=session_id,
        )
        llm_ms = (time.perf_counter() - llm_t0) * 1000

        # --- TTS stage ---
        if _is_pipeline_cancelled(session_id):
            clear_pipeline_session(session_id)
            raise PipelineInterruptedError(f"Session '{session_id}' cancelled after LLM.")
        tts_engine = tts_engine_id or persona.voice.engine or ""
        tts_voice = persona.voice.voice_id or ""
        tts_language = persona.voice.language or persona.preferred_language or ""
        tts_speaking_rate = persona.voice.speaking_rate
        tts_pitch = persona.voice.pitch

        tts_t0 = time.perf_counter()
        if dry_run:
            audio_out = b""
            audio_ct = "audio/wav"
            tts_eid = tts_engine or "dry-run"
            tts_backend = "dry-run"
            tts_vid = tts_voice
        else:
            tts_result = self.tts.synthesize_text(
                text_result.response_text,
                engine_id=tts_engine,
                voice_id=tts_voice,
                language=tts_language,
                speaking_rate=tts_speaking_rate,
                pitch=tts_pitch,
            )
            audio_out = tts_result.audio_bytes
            audio_ct = tts_result.content_type
            tts_eid = tts_result.engine_id
            tts_backend = tts_result.engine_backend
            tts_vid = tts_result.voice_id
        tts_ms = (time.perf_counter() - tts_t0) * 1000

        clear_pipeline_session(session_id)
        total_ms = (time.perf_counter() - started_at) * 1000

        return VoicePipelineResult(
            session_id=session_id,
            persona_id=persona.id,
            persona_name=persona.name,
            transcript=stt_result.text,
            stt_language=stt_result.language or "",
            stt_language_probability=stt_result.language_probability,
            stt_language_supported=stt_result.language_supported,
            stt_engine_id=stt_result.engine_id,
            stt_engine_backend=stt_result.engine_backend,
            stt_model=stt_result.model,
            stt_duration_ms=stt_result.transcription_duration_ms,
            response_text=text_result.response_text,
            prompt_final=text_result.prompt_final,
            llm_provider_id=text_result.provider_id,
            llm_provider_kind=text_result.provider_kind,
            llm_model=text_result.model,
            llm_fallback_used=text_result.fallback_used,
            llm_attempted_providers=text_result.attempted_providers,
            llm_injected_memories=text_result.injected_memories,
            llm_prompt_build_ms=text_result.prompt_build_duration_ms,
            llm_duration_ms=text_result.llm_total_duration_ms,
            audio_bytes=audio_out,
            audio_content_type=audio_ct,
            tts_engine_id=tts_eid,
            tts_engine_backend=tts_backend,
            tts_voice_id=tts_vid,
            tts_duration_ms=tts_ms,
            dry_run=dry_run,
            stt_ms=stt_ms,
            llm_ms=llm_ms,
            tts_ms=tts_ms,
            total_ms=total_ms,
        )
