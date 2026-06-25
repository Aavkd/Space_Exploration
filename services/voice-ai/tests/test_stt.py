from pathlib import Path

import pytest

from app.providers import stt as stt_module


class FakeSegment:
    def __init__(self, text: str) -> None:
        self.text = text


class FakeInfo:
    def __init__(self, language: str, probability: float, duration: float) -> None:
        self.language = language
        self.language_probability = probability
        self.duration = duration


class FakeWhisperModel:
    init_calls: list[dict[str, object]] = []
    transcribe_calls: list[dict[str, object]] = []
    detect_calls: list[dict[str, object]] = []
    # Simulates Whisper's English bias: French speech is assigned a higher probability than English, but
    # English still has meaningful mass and would win a naive full-vocabulary argmax with leading silence.
    detect_probs: list[tuple[str, float]] = [("fr", 0.82), ("en", 0.71), ("es", 0.05)]

    def __init__(self, model_name: str, **kwargs) -> None:
        self.model_name = model_name
        self.kwargs = kwargs
        FakeWhisperModel.init_calls.append({"model_name": model_name, "kwargs": kwargs})

    def detect_language(self, audio, **kwargs):
        FakeWhisperModel.detect_calls.append({"audio": audio, "kwargs": kwargs})
        best_language, best_probability = FakeWhisperModel.detect_probs[0]
        return (best_language, best_probability, list(FakeWhisperModel.detect_probs))

    def transcribe(self, audio_path: str, **kwargs):
        FakeWhisperModel.transcribe_calls.append({"audio_path": audio_path, "kwargs": kwargs})
        assert Path(audio_path).exists()
        return (
            [FakeSegment("Bonjour"), FakeSegment("capitaine.")],
            FakeInfo(kwargs.get("language", "fr"), 1.0, 2.48),
        )


@pytest.fixture(autouse=True)
def reset_fake_model_cache(monkeypatch: pytest.MonkeyPatch):
    FakeWhisperModel.init_calls = []
    FakeWhisperModel.transcribe_calls = []
    FakeWhisperModel.detect_calls = []
    FakeWhisperModel.detect_probs = [("fr", 0.82), ("en", 0.71), ("es", 0.05)]
    stt_module.FasterWhisperSttProvider._model_cache.clear()
    monkeypatch.setattr(stt_module, "WhisperModel", FakeWhisperModel)
    # detect_language needs a decoded 16kHz float array; bypass real codec decoding for the fake payload.
    monkeypatch.setattr(stt_module, "decode_audio", lambda input_file, sampling_rate=16000: f"decoded::{input_file}")


def test_stt_gateway_transcribes_browser_audio_without_persisting_raw_capture_by_default(
    app_context,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(stt_module.tempfile, "gettempdir", lambda: str(tmp_path))

    result = app_context.stt.transcribe_audio(
        b"fake-audio-payload",
        content_type="audio/webm;codecs=opus",
        filename="conversation-test.webm",
    )

    assert result.text == "Bonjour capitaine."
    assert result.language == "fr"
    assert result.language_probability == pytest.approx(0.82)
    assert result.language_supported is True
    assert result.engine_id == "faster-whisper"
    assert result.engine_backend == "faster-whisper"
    assert result.model == "base"
    assert result.audio_size_bytes == len(b"fake-audio-payload")
    assert result.content_type == "audio/webm"
    assert result.audio_duration_seconds == pytest.approx(2.48)
    assert result.transcription_duration_ms >= 0
    assert result.total_duration_ms >= 0

    assert FakeWhisperModel.init_calls == [
        {
            "model_name": "base",
            "kwargs": {
                "device": "auto",
                "compute_type": "default",
            },
        }
    ]
    # The language is resolved by an explicit, VAD-filtered detection pass restricted to fr/en, then forced
    # into the transcription so French is no longer overridden by Whisper's English prior.
    assert FakeWhisperModel.detect_calls[0]["kwargs"]["vad_filter"] is True
    assert FakeWhisperModel.detect_calls[0]["kwargs"]["language_detection_segments"] == 2
    assert FakeWhisperModel.transcribe_calls[0]["kwargs"]["beam_size"] == 5
    assert FakeWhisperModel.transcribe_calls[0]["kwargs"]["task"] == "transcribe"
    assert FakeWhisperModel.transcribe_calls[0]["kwargs"]["language"] == "fr"
    assert not (tmp_path / "deep-space-voice").exists()


def test_stt_gateway_detects_french_even_when_english_has_high_probability(app_context) -> None:
    # Regression for the "English detected, French never" report: even with strong English mass, the
    # constrained detection must still select French when it is the most probable supported language.
    FakeWhisperModel.detect_probs = [("en", 0.74), ("fr", 0.81), ("de", 0.10)]

    result = app_context.stt.transcribe_audio(
        b"fake-audio-payload",
        content_type="audio/webm;codecs=opus",
        filename="conversation-test.webm",
    )

    assert result.language == "fr"
    assert result.language_supported is True
    assert FakeWhisperModel.transcribe_calls[0]["kwargs"]["language"] == "fr"


def test_stt_gateway_falls_back_to_auto_when_detection_unavailable(
    app_context,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Older faster-whisper builds without detect_language must keep working via Whisper's built-in detection.
    monkeypatch.delattr(FakeWhisperModel, "detect_language", raising=False)

    result = app_context.stt.transcribe_audio(
        b"fake-audio-payload",
        content_type="audio/webm;codecs=opus",
        filename="conversation-test.webm",
    )

    assert result.language == "fr"
    assert "language" not in FakeWhisperModel.transcribe_calls[0]["kwargs"]
