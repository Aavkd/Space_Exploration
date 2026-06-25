from __future__ import annotations

import io
import math
import wave

import pytest

from app.audio import AudioActivityDetector, WakeWordDetector
from app.providers import llm as llm_module
from app.providers.stt import SttExecutionResult
from app.providers.tts import TtsExecutionResult


def _wav_bytes(*, amplitude: float, seconds: float = 0.4, sample_rate: int = 16_000) -> bytes:
    buffer = io.BytesIO()
    frame_count = int(seconds * sample_rate)
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        frames = bytearray()
        for index in range(frame_count):
            sample = int(math.sin(index / 6) * amplitude * 32767)
            frames.extend(sample.to_bytes(2, byteorder="little", signed=True))
        wav_file.writeframes(bytes(frames))
    return buffer.getvalue()


def _fake_stt_result(transcript: str) -> SttExecutionResult:
    return SttExecutionResult(
        text=transcript,
        language="en",
        language_probability=0.99,
        language_supported=True,
        engine_id="faster-whisper",
        engine_backend="faster-whisper",
        model="base",
        audio_duration_seconds=0.4,
        audio_size_bytes=4096,
        content_type="audio/wav",
        transcription_duration_ms=10.0,
        total_duration_ms=12.0,
    )


def _fake_tts_result() -> TtsExecutionResult:
    return TtsExecutionResult(
        audio_bytes=b"\x00\x01",
        content_type="audio/wav",
        engine_id="piper",
        engine_backend="piper-onnx",
        voice_id="test-voice",
        language="en",
        text_length=16,
        audio_size_bytes=2,
        generation_duration_ms=8.0,
        total_duration_ms=9.0,
    )


class FakeHttpClient:
    def __init__(self, timeout: int) -> None:
        self.timeout = timeout

    def __enter__(self) -> "FakeHttpClient":
        return self

    def __exit__(self, *args) -> bool:
        return False

    def post(self, url: str, json: dict) -> object:
        class FakeResp:
            status_code = 200

            def raise_for_status(self) -> None:
                pass

            def json(self) -> dict:
                return {"response": "The channel is open."}

        return FakeResp()


def test_audio_activity_detector_distinguishes_speech_and_silence(app_context) -> None:
    detector = AudioActivityDetector(app_context.config.voice)

    speech = detector.analyze(_wav_bytes(amplitude=0.25), content_type="audio/wav")
    silence = detector.analyze(_wav_bytes(amplitude=0.0), content_type="audio/wav")

    assert speech.speech_detected is True
    assert speech.silence_detected is False
    assert speech.rms > app_context.config.voice.modes.vad.threshold
    assert silence.speech_detected is False
    assert silence.silence_detected is False
    assert silence.rms == 0


def test_wake_word_detector_uses_configured_phrase(app_context) -> None:
    voice = app_context.config.voice
    voice.wake_word.phrase = "hello eternity"
    detector = WakeWordDetector(voice)

    assert detector.detect("Well, hello eternity, are you there?").detected is True
    assert detector.detect("Hello ship computer").detected is False


def test_audio_analyze_endpoint_returns_vad(client) -> None:
    response = client.post(
        "/api/v1/conversation/audio/analyze",
        content=_wav_bytes(amplitude=0.25),
        headers={"Content-Type": "audio/wav"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["vad"]["speech_detected"] is True
    assert data["voice"]["vad_enabled"] is True


def test_continuous_mode_waits_for_wake_word(client) -> None:
    client.app.state.app_context.stt.transcribe_audio = (
        lambda audio_bytes, **kw: _fake_stt_result("ordinary speech without the phrase")
    )

    response = client.post(
        "/api/v1/conversation/voice-mode?mode=continuous_conversation&session_id=wake-wait",
        content=_wav_bytes(amplitude=0.25),
        headers={"Content-Type": "audio/wav"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "waiting_for_wake_word"
    assert data["activated"] is False
    assert data["wake_word"]["detected"] is False


def test_continuous_mode_runs_pipeline_after_wake_word(client, monkeypatch: pytest.MonkeyPatch) -> None:
    providers = client.get("/api/v1/config/providers").json()
    providers["llm"]["providers"]["ollama_local"]["model"] = "llama3.1"
    client.put("/api/v1/config/providers", json=providers)

    monkeypatch.setattr(llm_module.httpx, "Client", FakeHttpClient)
    client.app.state.app_context.stt.transcribe_audio = (
        lambda audio_bytes, **kw: _fake_stt_result("eternity open the channel")
    )
    client.app.state.app_context.tts.synthesize_text = (
        lambda text, **kw: _fake_tts_result()
    )

    response = client.post(
        "/api/v1/conversation/voice-mode"
        "?mode=continuous_conversation&session_id=wake-run&run_pipeline=true&persona_id=eternity-infinity",
        content=_wav_bytes(amplitude=0.25),
        headers={"Content-Type": "audio/wav"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "activated"
    assert data["activated"] is True
    assert data["wake_word"]["detected"] is True
    assert data["pipeline"]["stages"]["llm"]["response_text"] == "The channel is open."
    assert data["pipeline"]["session"]["assistant_speaking"] is True


def test_continuous_mode_can_activate_without_wake_word_when_disabled(client) -> None:
    voice = client.get("/api/v1/config/voice").json()
    voice["wake_word"]["enabled"] = False
    client.put("/api/v1/config/voice", json=voice)

    response = client.post(
        "/api/v1/conversation/voice-mode?mode=continuous_conversation&session_id=no-wake",
        content=_wav_bytes(amplitude=0.25),
        headers={"Content-Type": "audio/wav"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "activated"
    assert data["activated"] is True
    assert "wake_word" not in data


def test_voice_mode_barge_in_interrupts_assistant(client) -> None:
    response = client.post(
        "/api/v1/conversation/voice-mode"
        "?mode=continuous_conversation&session_id=barge-test&assistant_speaking=true",
        content=_wav_bytes(amplitude=0.25),
        headers={"Content-Type": "audio/wav"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "barge_in"
    assert data["interrupted"] is True
    assert data["session"]["assistant_speaking"] is False
