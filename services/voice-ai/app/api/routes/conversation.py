from __future__ import annotations

import base64
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import Field

from app.audio import AudioActivityDetector, WakeWordDetector
from app.config.loader import AppContext
from app.config.models import StrictConfigModel, VoiceModeName
from app.conversation import ConversationPersonaError, PipelineInterruptedError, cancel_pipeline_session
from app.providers.llm import LlmExecutionError
from app.providers.stt import SttExecutionError
from app.providers.tts import TtsExecutionError, TtsProviderError


router = APIRouter(tags=["conversation"])


def _voice_pipeline_payload(result) -> dict[str, object]:
    audio_payload: dict[str, object] = {"content_type": result.audio_content_type}
    if not result.dry_run:
        audio_payload["audio_base64"] = base64.b64encode(result.audio_bytes).decode("ascii")

    llm_stage: dict[str, object] = {
        "response_text": result.response_text,
        "provider_id": result.llm_provider_id,
        "provider_kind": result.llm_provider_kind,
        "model": result.llm_model,
        "fallback_used": result.llm_fallback_used,
        "attempted_providers": result.llm_attempted_providers,
        "injected_memories": result.llm_injected_memories,
        "prompt_build_ms": round(result.llm_prompt_build_ms, 2),
        "duration_ms": round(result.llm_duration_ms, 2),
    }
    if result.dry_run:
        llm_stage["prompt_final"] = result.prompt_final
        llm_stage["injected_memories"] = result.llm_injected_memories

    return {
        "session_id": result.session_id,
        "persona_id": result.persona_id,
        "persona_name": result.persona_name,
        "dry_run": result.dry_run,
        "interrupted": False,
        "stages": {
            "stt": {
                "transcript": result.transcript,
                "language": result.stt_language,
                "language_probability": round(result.stt_language_probability, 4),
                "language_supported": result.stt_language_supported,
                "engine_id": result.stt_engine_id,
                "engine_backend": result.stt_engine_backend,
                "model": result.stt_model,
                "duration_ms": round(result.stt_duration_ms, 2),
            },
            "llm": llm_stage,
            "tts": {
                "engine_id": result.tts_engine_id,
                "engine_backend": result.tts_engine_backend,
                "voice_id": result.tts_voice_id,
                "duration_ms": round(result.tts_duration_ms, 2),
            },
        },
        "audio": audio_payload,
        "timings": {
            "stt_ms": round(result.stt_ms, 2),
            "llm_ms": round(result.llm_ms, 2),
            "tts_ms": round(result.tts_ms, 2),
            "total_ms": round(result.total_ms, 2),
        },
    }


class TextConversationRequest(StrictConfigModel):
    message: str = Field(min_length=1)
    provider_id: str = ""
    persona_id: str = ""
    dry_run: bool = False


@router.post("/api/v1/conversation/text")
def submit_text_conversation(request: Request, payload: TextConversationRequest) -> dict[str, object]:
    context: AppContext = request.app.state.app_context
    try:
        result = context.conversation.submit_text(
            payload.message,
            provider_id=payload.provider_id.strip(),
            persona_id=payload.persona_id.strip(),
        )
    except ConversationPersonaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LlmExecutionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    response_payload: dict[str, object] = {
        "persona_id": result.persona_id,
        "persona": result.persona_snapshot,
        "input_text": result.input_text,
        "response_text": result.response_text,
        "provider": {
            "id": result.provider_id,
            "kind": result.provider_kind,
            "model": result.model,
        },
        "fallback_used": result.fallback_used,
        "attempted_providers": result.attempted_providers,
        "injected_memories": result.injected_memories,
        "timings": {
            "prompt_build_ms": round(result.prompt_build_duration_ms, 2),
            "provider_ms": round(result.provider_duration_ms, 2),
            "llm_total_ms": round(result.llm_total_duration_ms, 2),
            "total_ms": round(result.total_duration_ms, 2),
        },
    }
    if payload.dry_run:
        response_payload["dry_run"] = {
            "enabled": True,
            "prompt_final": result.prompt_final,
            "provider": {
                "id": result.provider_id,
                "kind": result.provider_kind,
                "model": result.model,
            },
            "injected_memories": result.injected_memories,
        }
    else:
        response_payload["dry_run"] = {"enabled": False}
    return response_payload


@router.post("/api/v1/conversation/transcribe")
async def transcribe_audio(request: Request, engine_id: str = "") -> dict[str, object]:
    context: AppContext = request.app.state.app_context
    audio_bytes = await request.body()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio payload is empty.")

    content_type = request.headers.get("content-type", "application/octet-stream")
    filename = request.headers.get("x-audio-filename", "browser-capture.webm")

    try:
        result = context.stt.transcribe_audio(
            audio_bytes,
            content_type=content_type,
            filename=filename,
            engine_id=engine_id.strip(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SttExecutionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "transcript": {
            "text": result.text,
            "language": result.language or "unknown",
            "language_probability": round(result.language_probability, 4),
            "language_supported": result.language_supported,
        },
        "engine": {
            "id": result.engine_id,
            "backend": result.engine_backend,
            "model": result.model,
        },
        "audio": {
            "content_type": result.content_type,
            "size_bytes": result.audio_size_bytes,
            "duration_seconds": round(result.audio_duration_seconds, 2),
            "debug_capture_enabled": context.config.runtime.debug_audio_capture,
        },
        "timings": {
            "transcription_ms": round(result.transcription_duration_ms, 2),
            "total_ms": round(result.total_duration_ms, 2),
        },
    }


# ---------------------------------------------------------------------------
# TTS synthesis
# ---------------------------------------------------------------------------


class TtsSynthesisRequest(StrictConfigModel):
    text: str = Field(min_length=1, max_length=4000)
    engine_id: str = ""
    persona_id: str = ""
    voice_id: str = ""
    language: str = ""
    speaking_rate: Optional[float] = Field(default=None, ge=0.1, le=4.0)
    pitch: Optional[float] = Field(default=None, ge=-2.0, le=2.0)
    dry_run: bool = False


@router.post("/api/v1/conversation/tts")
def synthesize_tts(request: Request, payload: TtsSynthesisRequest) -> dict[str, object]:
    context: AppContext = request.app.state.app_context

    # Resolve voice settings — persona provides defaults, explicit fields override
    engine_id = payload.engine_id.strip()
    voice_id = payload.voice_id.strip()
    language = payload.language.strip()
    speaking_rate = payload.speaking_rate
    pitch = payload.pitch
    resolved_persona_id = ""
    resolved_persona_name = ""

    persona_id_req = payload.persona_id.strip()
    if persona_id_req:
        persona_map = {p.id: p for p in context.config.personas.personas}
        persona = persona_map.get(persona_id_req)
        if persona is None:
            available = ", ".join(sorted(persona_map)) or "<none>"
            raise HTTPException(
                status_code=400,
                detail=f"Persona '{persona_id_req}' not found. Available: {available}",
            )
        resolved_persona_id = persona.id
        resolved_persona_name = persona.name
        if not engine_id:
            engine_id = persona.voice.engine or ""
        if not voice_id:
            voice_id = persona.voice.voice_id or ""
        if not language:
            language = persona.voice.language or ""
        if speaking_rate is None:
            speaking_rate = persona.voice.speaking_rate
        if pitch is None:
            pitch = persona.voice.pitch

    effective_speaking_rate = speaking_rate if speaking_rate is not None else 1.0
    effective_pitch = pitch if pitch is not None else 0.0

    try:
        result = context.tts.synthesize_text(
            payload.text,
            engine_id=engine_id,
            voice_id=voice_id,
            language=language,
            speaking_rate=effective_speaking_rate,
            pitch=effective_pitch,
        )
    except TtsProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except TtsExecutionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    audio_payload: dict[str, object] = {
        "content_type": result.content_type,
        "size_bytes": result.audio_size_bytes,
        "sample_rate_hz": result.sample_rate_hz,
        "channels": result.channels,
        "sample_width": result.sample_width,
    }
    if not payload.dry_run:
        audio_payload["audio_base64"] = base64.b64encode(result.audio_bytes).decode("ascii")

    return {
        "engine": {
            "id": result.engine_id,
            "backend": result.engine_backend,
            "voice_id": result.voice_id,
        },
        "synthesis": {
            "text_length": result.text_length,
            "language": result.language,
            "speaking_rate": effective_speaking_rate,
            "pitch": effective_pitch,
        },
        "audio": audio_payload,
        "persona_id": resolved_persona_id,
        "persona_name": resolved_persona_name,
        "timings": {
            "generation_ms": round(result.generation_duration_ms, 2),
            "total_ms": round(result.total_duration_ms, 2),
        },
        "dry_run": {"enabled": payload.dry_run},
    }


# ---------------------------------------------------------------------------
# Full voice pipeline  (audio → STT → LLM → TTS → audio)
# ---------------------------------------------------------------------------


@router.post("/api/v1/conversation/voice")
async def run_voice_pipeline(
    request: Request,
    persona_id: str = "",
    provider_id: str = "",
    stt_engine_id: str = "",
    tts_engine_id: str = "",
    session_id: str = "",
    dry_run: bool = False,
) -> dict[str, object]:
    """Run the full micro → STT → LLM → TTS pipeline.

    Audio bytes are the raw request body. Pipeline options are passed as query
    parameters so that the body can remain a plain binary stream (matching the
    existing /transcribe pattern).
    """
    context: AppContext = request.app.state.app_context
    audio_bytes = await request.body()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio payload is empty.")

    content_type = request.headers.get("content-type", "audio/webm")
    filename = request.headers.get("x-audio-filename", "pipeline-input.webm")

    try:
        result = context.pipeline.run_pipeline(
            audio_bytes,
            content_type=content_type,
            filename=filename,
            persona_id=persona_id.strip(),
            provider_id=provider_id.strip(),
            stt_engine_id=stt_engine_id.strip(),
            tts_engine_id=tts_engine_id.strip(),
            session_id=session_id.strip(),
            dry_run=dry_run,
        )
    except ConversationPersonaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PipelineInterruptedError as exc:
        return {
            "interrupted": True,
            "interrupted_reason": str(exc),
            "session_id": session_id,
        }
    except SttExecutionError as exc:
        raise HTTPException(status_code=502, detail=f"STT stage failed: {exc}") from exc
    except LlmExecutionError as exc:
        raise HTTPException(status_code=502, detail=f"LLM stage failed: {exc}") from exc
    except (TtsExecutionError, TtsProviderError) as exc:
        raise HTTPException(status_code=502, detail=f"TTS stage failed: {exc}") from exc

    return _voice_pipeline_payload(result)


# ---------------------------------------------------------------------------
# Voice modes, VAD and wake-word gating
# ---------------------------------------------------------------------------


@router.post("/api/v1/conversation/audio/analyze")
async def analyze_audio_activity(request: Request) -> dict[str, object]:
    context: AppContext = request.app.state.app_context
    audio_bytes = await request.body()
    content_type = request.headers.get("content-type", "application/octet-stream")
    vad = AudioActivityDetector(context.config.voice).analyze(audio_bytes, content_type=content_type)
    return {
        "vad": vad.as_dict(),
        "voice": {
            "vad_enabled": context.config.voice.modes.vad_enabled and context.config.voice.modes.vad.enabled,
            "default_mode": context.config.voice.modes.default_mode,
        },
    }


@router.post("/api/v1/conversation/voice-mode")
async def run_voice_mode(
    request: Request,
    mode: VoiceModeName | None = None,
    session_id: str = "",
    persona_id: str = "",
    provider_id: str = "",
    stt_engine_id: str = "",
    tts_engine_id: str = "",
    assistant_speaking: bool = False,
    run_pipeline: bool = False,
    dry_run: bool = False,
) -> dict[str, object]:
    """Gate audio through the configured voice interaction mode."""
    context: AppContext = request.app.state.app_context
    audio_bytes = await request.body()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio payload is empty.")

    voice_mode = mode or context.config.voice.modes.default_mode
    if voice_mode not in context.config.voice.modes.available_modes:
        raise HTTPException(
            status_code=400,
            detail=f"Voice mode '{voice_mode}' is not enabled in voice.modes.available_modes.",
        )

    normalized_session_id = session_id.strip() or f"{voice_mode}-anonymous"
    content_type = request.headers.get("content-type", "audio/webm")
    filename = request.headers.get("x-audio-filename", "voice-mode-input.webm")
    vad = AudioActivityDetector(context.config.voice).analyze(audio_bytes, content_type=content_type)
    vad_gate_enabled = context.config.voice.modes.vad_enabled and context.config.voice.modes.vad.enabled
    session_state = context.voice_sessions.get(normalized_session_id, voice_mode)
    session_state.assistant_speaking = assistant_speaking

    base_payload: dict[str, object] = {
        "session_id": normalized_session_id,
        "mode": voice_mode,
        "vad": vad.as_dict(),
        "activated": False,
        "status": "listening",
        "interrupted": False,
        "session": {
            "activated": session_state.activated,
            "assistant_speaking": session_state.assistant_speaking,
        },
    }

    if vad_gate_enabled and not vad.speech_detected:
        base_payload["status"] = "silence"
        return base_payload

    if assistant_speaking and context.config.voice.modes.allow_barge_in and vad.speech_detected:
        cancel_pipeline_session(normalized_session_id)
        context.voice_sessions.set_assistant_speaking(normalized_session_id, voice_mode, False)
        base_payload.update(
            {
                "status": "barge_in",
                "interrupted": True,
                "interrupted_reason": "User speech detected while assistant output was active.",
                "session": {
                    "activated": session_state.activated,
                    "assistant_speaking": False,
                },
            }
        )
        return base_payload

    wake_result = None
    must_wait_for_wake = (
        voice_mode == "continuous_conversation"
        and context.config.voice.modes.continuous_requires_wake_word
        and context.config.voice.wake_word.enabled
        and not session_state.activated
    )
    if must_wait_for_wake:
        try:
            stt_result = context.stt.transcribe_audio(
                audio_bytes,
                content_type=content_type,
                filename=filename,
                engine_id=(stt_engine_id.strip() or context.config.voice.wake_word.provider_engine),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except SttExecutionError as exc:
            raise HTTPException(status_code=502, detail=f"Wake word STT failed: {exc}") from exc

        wake_result = WakeWordDetector(context.config.voice).detect(stt_result.text)
        base_payload["wake_word"] = wake_result.as_dict()
        base_payload["transcript"] = {
            "text": stt_result.text,
            "language": stt_result.language or "unknown",
            "language_probability": round(stt_result.language_probability, 4),
        }
        if not wake_result.detected:
            base_payload["status"] = "waiting_for_wake_word"
            return base_payload

    continuous_without_wake = (
        voice_mode == "continuous_conversation"
        and (not context.config.voice.modes.continuous_requires_wake_word or not context.config.voice.wake_word.enabled)
    )
    activated = (
        voice_mode in {"push_to_talk", "voice_activity"}
        or continuous_without_wake
        or session_state.activated
        or bool(wake_result and wake_result.detected)
    )
    context.voice_sessions.mark_activity(normalized_session_id, voice_mode, activated=activated)
    base_payload["activated"] = activated
    base_payload["status"] = "activated" if activated else "listening"
    base_payload["session"] = {
        "activated": activated,
        "assistant_speaking": False,
    }

    if not activated or not run_pipeline:
        return base_payload

    try:
        result = context.pipeline.run_pipeline(
            audio_bytes,
            content_type=content_type,
            filename=filename,
            persona_id=persona_id.strip(),
            provider_id=provider_id.strip(),
            stt_engine_id=stt_engine_id.strip(),
            tts_engine_id=tts_engine_id.strip(),
            session_id=normalized_session_id,
            dry_run=dry_run,
        )
    except ConversationPersonaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PipelineInterruptedError as exc:
        base_payload.update(
            {
                "status": "interrupted",
                "interrupted": True,
                "interrupted_reason": str(exc),
            }
        )
        return base_payload
    except SttExecutionError as exc:
        raise HTTPException(status_code=502, detail=f"STT stage failed: {exc}") from exc
    except LlmExecutionError as exc:
        raise HTTPException(status_code=502, detail=f"LLM stage failed: {exc}") from exc
    except (TtsExecutionError, TtsProviderError) as exc:
        raise HTTPException(status_code=502, detail=f"TTS stage failed: {exc}") from exc

    pipeline_payload = _voice_pipeline_payload(result)
    if context.config.voice.modes.auto_listen_after_response and not result.dry_run:
        context.voice_sessions.set_assistant_speaking(normalized_session_id, voice_mode, True)
        pipeline_payload["session"] = {
            "activated": True,
            "assistant_speaking": True,
        }

    base_payload["pipeline"] = pipeline_payload
    base_payload["session"] = pipeline_payload.get("session", base_payload["session"])
    return base_payload


# ---------------------------------------------------------------------------
# Pipeline interrupt
# ---------------------------------------------------------------------------


class InterruptRequest(StrictConfigModel):
    session_id: str = Field(min_length=1)


@router.post("/api/v1/conversation/interrupt")
def interrupt_pipeline_session(payload: InterruptRequest) -> dict[str, object]:
    """Mark a running pipeline session as cancelled.

    The pipeline checks for cancellation between STT, LLM, and TTS stages.
    If the pipeline has already passed a checkpoint, the current stage runs to
    completion and the interrupt takes effect before the next one starts.
    """
    cancel_pipeline_session(payload.session_id)
    return {"session_id": payload.session_id, "interrupted": True}
