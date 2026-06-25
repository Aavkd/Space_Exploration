"""Tests for the full voice pipeline (STT → LLM → TTS)."""

from __future__ import annotations

import pytest

from app.conversation import (
    ConversationOrchestrator,
    ConversationTextResult,
    PipelineInterruptedError,
    VoicePipelineOrchestrator,
    VoicePipelineResult,
    cancel_pipeline_session,
    clear_pipeline_session,
)
from app.providers import llm as llm_module
from app.providers.stt import SttExecutionResult
from app.providers.tts import TtsExecutionResult


# ---------------------------------------------------------------------------
# Fake implementations
# ---------------------------------------------------------------------------


class FakeSttGateway:
    def __init__(self, result: SttExecutionResult) -> None:
        self._result = result
        self.called_with: dict = {}

    def transcribe_audio(self, audio_bytes: bytes, *, content_type: str = "", filename: str = "", engine_id: str = "") -> SttExecutionResult:
        self.called_with = {"audio_bytes": audio_bytes, "content_type": content_type, "engine_id": engine_id}
        return self._result


class FakeTtsGateway:
    def __init__(self, result: TtsExecutionResult) -> None:
        self._result = result
        self.called_with: dict = {}

    def synthesize_text(self, text: str, engine_id: str = "", voice_id: str = "", language: str = "", speaking_rate: float = 1.0, pitch: float = 0.0) -> TtsExecutionResult:
        self.called_with = {"text": text, "engine_id": engine_id, "voice_id": voice_id, "language": language}
        return self._result


def _fake_stt_result(transcript: str = "Hello cosmos.") -> SttExecutionResult:
    return SttExecutionResult(
        text=transcript,
        language="en",
        language_probability=0.98,
        language_supported=True,
        engine_id="faster-whisper",
        engine_backend="faster-whisper",
        model="base",
        audio_duration_seconds=1.5,
        audio_size_bytes=12000,
        content_type="audio/webm",
        transcription_duration_ms=180.0,
        total_duration_ms=195.0,
    )


def _fake_tts_result() -> TtsExecutionResult:
    return TtsExecutionResult(
        audio_bytes=b"\x00" * 1024,
        content_type="audio/wav",
        engine_id="piper",
        engine_backend="piper-onnx",
        voice_id="en_US-cosmic",
        language="en",
        text_length=42,
        audio_size_bytes=1024,
        generation_duration_ms=210.0,
        total_duration_ms=220.0,
    )


class FakeHttpClient:
    scenarios: list = []
    requests: list[dict] = []

    def __init__(self, timeout: int) -> None:
        self.timeout = timeout

    def __enter__(self) -> "FakeHttpClient":
        return self

    def __exit__(self, *args) -> bool:
        return False

    def post(self, url: str, json: dict) -> object:
        FakeHttpClient.requests.append({"url": url, "json": json})

        class FakeResp:
            status_code = 200

            def raise_for_status(self) -> None:
                pass

            def json(self) -> dict:
                return {"response": "Cosmic reply from the void."}

        return FakeResp()


def _build_pipeline(app_context, transcript: str = "Hello cosmos."):
    """Build a VoicePipelineOrchestrator with fakes wired in."""
    stt = FakeSttGateway(_fake_stt_result(transcript))
    tts = FakeTtsGateway(_fake_tts_result())
    return VoicePipelineOrchestrator(
        conversation=app_context.conversation,
        stt=stt,
        tts=tts,
    ), stt, tts


# ---------------------------------------------------------------------------
# Unit tests — VoicePipelineOrchestrator
# ---------------------------------------------------------------------------


def test_pipeline_runs_all_three_stages(app_context, monkeypatch: pytest.MonkeyPatch) -> None:
    providers = app_context.store.load_providers()
    providers.llm.providers["ollama_local"].model = "llama3.1"
    app_context.store.save_providers(providers)
    app_context.conversation.llm_gateway._config = app_context.store.load_providers().llm

    FakeHttpClient.scenarios = []
    FakeHttpClient.requests = []
    monkeypatch.setattr(llm_module.httpx, "Client", FakeHttpClient)

    pipeline, stt, tts = _build_pipeline(app_context)
    result = pipeline.run_pipeline(
        b"fake-audio",
        content_type="audio/webm",
        filename="test.webm",
        persona_id="eternity-infinity",
        dry_run=False,
    )

    assert isinstance(result, VoicePipelineResult)
    assert result.transcript == "Hello cosmos."
    assert result.response_text == "Cosmic reply from the void."
    assert result.audio_bytes == b"\x00" * 1024
    assert result.audio_content_type == "audio/wav"
    assert result.stt_engine_id == "faster-whisper"
    assert result.tts_engine_id == "piper"
    assert result.dry_run is False
    assert result.stt_ms > 0
    assert result.llm_ms > 0
    assert result.tts_ms > 0
    assert result.total_ms >= result.stt_ms + result.llm_ms + result.tts_ms - 1


def test_pipeline_dry_run_skips_tts_audio(app_context, monkeypatch: pytest.MonkeyPatch) -> None:
    providers = app_context.store.load_providers()
    providers.llm.providers["ollama_local"].model = "llama3.1"
    app_context.store.save_providers(providers)
    app_context.conversation.llm_gateway._config = app_context.store.load_providers().llm

    FakeHttpClient.scenarios = []
    FakeHttpClient.requests = []
    monkeypatch.setattr(llm_module.httpx, "Client", FakeHttpClient)

    pipeline, stt, tts = _build_pipeline(app_context)
    result = pipeline.run_pipeline(
        b"fake-audio",
        content_type="audio/webm",
        persona_id="eternity-infinity",
        dry_run=True,
    )

    assert result.dry_run is True
    assert result.audio_bytes == b""
    assert result.tts_engine_backend == "dry-run"
    # TTS gateway was never called
    assert tts.called_with == {}
    # STT and LLM were still called
    assert stt.called_with["audio_bytes"] == b"fake-audio"
    assert result.prompt_final != ""
    assert "USER MESSAGE" in result.prompt_final


def test_pipeline_uses_persona_voice_settings(app_context, monkeypatch: pytest.MonkeyPatch) -> None:
    providers = app_context.store.load_providers()
    providers.llm.providers["ollama_local"].model = "llama3.1"
    app_context.store.save_providers(providers)
    app_context.conversation.llm_gateway._config = app_context.store.load_providers().llm

    FakeHttpClient.scenarios = []
    FakeHttpClient.requests = []
    monkeypatch.setattr(llm_module.httpx, "Client", FakeHttpClient)

    pipeline, _, tts = _build_pipeline(app_context)
    pipeline.run_pipeline(b"audio", persona_id="eternity-infinity", dry_run=False)

    persona = app_context.conversation.resolve_persona("eternity-infinity")
    assert tts.called_with["engine_id"] == (persona.voice.engine or "")
    assert tts.called_with["language"] == (persona.voice.language or persona.preferred_language)


def test_pipeline_raises_on_unknown_persona(app_context) -> None:
    from app.conversation import ConversationPersonaError
    pipeline, _, _ = _build_pipeline(app_context)
    with pytest.raises(ConversationPersonaError, match="ghost-persona"):
        pipeline.run_pipeline(b"audio", persona_id="ghost-persona")


def test_pipeline_interrupt_before_stt(app_context) -> None:
    pipeline, stt, _ = _build_pipeline(app_context)
    session = "test-session-pre-stt"
    cancel_pipeline_session(session)
    try:
        with pytest.raises(PipelineInterruptedError):
            pipeline.run_pipeline(b"audio", session_id=session, persona_id="eternity-infinity")
        # STT was never called
        assert stt.called_with == {}
    finally:
        clear_pipeline_session(session)


def test_pipeline_interrupt_after_stt(app_context, monkeypatch: pytest.MonkeyPatch) -> None:
    providers = app_context.store.load_providers()
    providers.llm.providers["ollama_local"].model = "llama3.1"
    app_context.store.save_providers(providers)
    app_context.conversation.llm_gateway._config = app_context.store.load_providers().llm

    FakeHttpClient.scenarios = []
    FakeHttpClient.requests = []
    monkeypatch.setattr(llm_module.httpx, "Client", FakeHttpClient)

    session = "test-session-post-stt"

    original_transcribe = FakeSttGateway.transcribe_audio

    def transcribe_and_cancel(self, audio_bytes, **kwargs):
        result = original_transcribe(self, audio_bytes, **kwargs)
        cancel_pipeline_session(session)
        return result

    pipeline, stt, tts = _build_pipeline(app_context)
    stt.transcribe_audio = transcribe_and_cancel.__get__(stt, type(stt))  # type: ignore[method-assign]

    try:
        with pytest.raises(PipelineInterruptedError):
            pipeline.run_pipeline(b"audio", session_id=session, persona_id="eternity-infinity")
        # LLM was never called
        assert FakeHttpClient.requests == []
        assert tts.called_with == {}
    finally:
        clear_pipeline_session(session)


# ---------------------------------------------------------------------------
# API endpoint tests
# ---------------------------------------------------------------------------


def test_voice_pipeline_endpoint_returns_all_stages(client, monkeypatch: pytest.MonkeyPatch) -> None:
    providers = client.get("/api/v1/config/providers").json()
    providers["llm"]["providers"]["ollama_local"]["model"] = "llama3.1"
    client.put("/api/v1/config/providers", json=providers)

    FakeHttpClient.scenarios = []
    FakeHttpClient.requests = []
    monkeypatch.setattr(llm_module.httpx, "Client", FakeHttpClient)

    stt_result = _fake_stt_result("Reveal yourself, entity.")
    tts_result = _fake_tts_result()

    client.app.state.app_context.stt.transcribe_audio = (
        lambda audio_bytes, **kw: stt_result
    )
    client.app.state.app_context.tts.synthesize_text = (
        lambda text, **kw: tts_result
    )

    response = client.post(
        "/api/v1/conversation/voice?persona_id=eternity-infinity",
        content=b"fake-webm-audio",
        headers={"Content-Type": "audio/webm"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["interrupted"] is False
    assert data["dry_run"] is False
    assert data["stages"]["stt"]["transcript"] == "Reveal yourself, entity."
    assert data["stages"]["stt"]["language"] == "en"
    assert data["stages"]["llm"]["response_text"] == "Cosmic reply from the void."
    assert data["stages"]["tts"]["engine_id"] == "piper"
    assert "audio_base64" in data["audio"]
    assert data["timings"]["stt_ms"] >= 0
    assert data["timings"]["llm_ms"] >= 0
    assert data["timings"]["tts_ms"] >= 0
    assert data["timings"]["total_ms"] >= 0


def test_voice_pipeline_endpoint_dry_run(client, monkeypatch: pytest.MonkeyPatch) -> None:
    providers = client.get("/api/v1/config/providers").json()
    providers["llm"]["providers"]["ollama_local"]["model"] = "llama3.1"
    client.put("/api/v1/config/providers", json=providers)

    FakeHttpClient.scenarios = []
    FakeHttpClient.requests = []
    monkeypatch.setattr(llm_module.httpx, "Client", FakeHttpClient)

    stt_result = _fake_stt_result("Tell me everything.")
    tts_calls: list = []

    def fake_tts(text, **kw):
        tts_calls.append(text)
        return _fake_tts_result()

    client.app.state.app_context.stt.transcribe_audio = lambda audio_bytes, **kw: stt_result
    client.app.state.app_context.tts.synthesize_text = fake_tts

    response = client.post(
        "/api/v1/conversation/voice?persona_id=eternity-infinity&dry_run=true",
        content=b"fake-webm-audio",
        headers={"Content-Type": "audio/webm"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["dry_run"] is True
    assert "audio_base64" not in data["audio"]
    assert "prompt_final" in data["stages"]["llm"]
    assert "USER MESSAGE" in data["stages"]["llm"]["prompt_final"]
    assert tts_calls == []


def test_voice_pipeline_endpoint_rejects_empty_body(client) -> None:
    response = client.post(
        "/api/v1/conversation/voice",
        content=b"",
        headers={"Content-Type": "audio/webm"},
    )
    assert response.status_code == 400
    assert "empty" in response.json()["detail"]


def test_voice_pipeline_endpoint_rejects_unknown_persona(client) -> None:
    response = client.post(
        "/api/v1/conversation/voice?persona_id=unknown-ghost",
        content=b"fake-audio",
        headers={"Content-Type": "audio/webm"},
    )
    assert response.status_code == 400
    assert "unknown-ghost" in response.json()["detail"]


def test_interrupt_endpoint_marks_session_cancelled(client) -> None:
    response = client.post(
        "/api/v1/conversation/interrupt",
        json={"session_id": "test-interrupt-001"},
    )
    assert response.status_code == 200
    assert response.json()["interrupted"] is True
    assert response.json()["session_id"] == "test-interrupt-001"
    # Clean up so other tests are not affected
    clear_pipeline_session("test-interrupt-001")


def test_interrupt_endpoint_rejects_empty_session_id(client) -> None:
    response = client.post(
        "/api/v1/conversation/interrupt",
        json={"session_id": ""},
    )
    assert response.status_code == 422


def test_voice_pipeline_endpoint_returns_interrupted_when_cancelled(client, monkeypatch: pytest.MonkeyPatch) -> None:
    providers = client.get("/api/v1/config/providers").json()
    providers["llm"]["providers"]["ollama_local"]["model"] = "llama3.1"
    client.put("/api/v1/config/providers", json=providers)

    session = "test-pre-cancelled-session"
    cancel_pipeline_session(session)

    try:
        response = client.post(
            f"/api/v1/conversation/voice?persona_id=eternity-infinity&session_id={session}",
            content=b"fake-audio",
            headers={"Content-Type": "audio/webm"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["interrupted"] is True
        assert "session_id" in data
    finally:
        clear_pipeline_session(session)
