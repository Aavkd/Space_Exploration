"""Tests for TTS providers, gateway and the /api/v1/conversation/tts endpoint."""

from __future__ import annotations

import base64
import io
import wave
from unittest.mock import MagicMock, patch

import pytest

from app.config.models import EngineConnectionConfig, TtsProvidersConfig
from app.providers.tts import (
    CoquiXttsTtsProvider,
    PiperTtsProvider,
    ReservedTtsProvider,
    TtsExecutionResult,
    TtsGateway,
    TtsProviderConfigurationError,
    TtsProviderNotImplementedError,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _minimal_wav(sample_rate: int = 22050) -> bytes:
    """Generate a valid, minimal WAV buffer (200 silent samples ≈ 9 ms)."""
    buf = io.BytesIO()
    with wave.open(buf, "w") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00\x00" * 200)
    return buf.getvalue()


def _fake_piper_synthesize(text, wav_file, length_scale=None, syn_config=None, **kwargs):
    """Side-effect for mocked PiperVoice.synthesize that writes valid WAV data."""
    wav_file.setnchannels(1)
    wav_file.setsampwidth(2)
    wav_file.setframerate(22050)
    wav_file.writeframes(b"\x00\x00" * 220)


class _FakeSynthesisConfig:
    def __init__(self, length_scale: float = 1.0) -> None:
        self.length_scale = length_scale


def _make_engine_config(
    backend: str = "piper",
    enabled: bool = True,
    model: str = "",
    language: str = "en",
    **options,
) -> EngineConnectionConfig:
    return EngineConnectionConfig(
        enabled=enabled,
        backend=backend,
        endpoint="",
        model=model,
        api_key_env="",
        language=language,
        stream=False,
        options=options,
    )


def _make_tts_providers_config(
    engines: dict | None = None,
    default_engine: str = "piper",
) -> TtsProvidersConfig:
    if engines is None:
        engines = {
            "piper": {
                "enabled": True,
                "backend": "piper",
                "endpoint": "",
                "model": "",
                "api_key_env": "",
                "language": "en",
                "stream": False,
                "options": {"sample_rate_hz": 22050},
            }
        }
    return TtsProvidersConfig.model_validate({"engines": engines, "default_engine": default_engine})


def _make_result(**overrides) -> TtsExecutionResult:
    defaults = dict(
        audio_bytes=b"FAKEWAV",
        content_type="audio/wav",
        engine_id="piper",
        engine_backend="piper",
        voice_id="model.onnx",
        language="en",
        text_length=11,
        audio_size_bytes=7,
        generation_duration_ms=80.0,
        total_duration_ms=85.0,
    )
    defaults.update(overrides)
    return TtsExecutionResult(**defaults)


# ---------------------------------------------------------------------------
# PiperTtsProvider
# ---------------------------------------------------------------------------


class TestPiperTtsProvider:
    def setup_method(self):
        PiperTtsProvider._voice_cache.clear()

    def test_raises_config_error_when_model_path_missing(self):
        config = _make_engine_config(model_path="")
        provider = PiperTtsProvider("piper", config)
        with pytest.raises(TtsProviderConfigurationError, match="model"):
            provider.synthesize("Hello world")

    def test_raises_config_error_when_model_path_empty_in_options(self):
        config = _make_engine_config()
        provider = PiperTtsProvider("piper", config)
        with pytest.raises(TtsProviderConfigurationError, match="model"):
            provider.synthesize("Hello", voice_id="")

    def test_raises_config_error_when_model_file_not_found(self, tmp_path):
        missing_path = str(tmp_path / "missing.onnx")
        config = _make_engine_config(model_path=missing_path)
        provider = PiperTtsProvider("piper", config)

        mock_piper = MagicMock()
        mock_piper.PiperVoice = MagicMock()
        with patch.dict("sys.modules", {"piper": mock_piper}):
            with pytest.raises(TtsProviderConfigurationError, match="not found"):
                provider.synthesize("Hello")

    def test_synthesize_succeeds_with_mocked_voice(self, tmp_path):
        onnx_path = tmp_path / "model.onnx"
        onnx_path.write_bytes(b"fake_model_data")
        config = _make_engine_config(model_path=str(onnx_path), sample_rate_hz=22050)
        provider = PiperTtsProvider("piper", config)

        fake_voice = MagicMock()
        fake_voice.synthesize_wav.side_effect = _fake_piper_synthesize
        mock_piper = MagicMock()
        mock_piper.PiperVoice.load.return_value = fake_voice
        mock_piper.SynthesisConfig = _FakeSynthesisConfig

        with patch.dict("sys.modules", {"piper": mock_piper}):
            result = provider.synthesize("Test synthesis.", speaking_rate=1.0)

        assert result.engine_id == "piper"
        assert result.engine_backend == "piper"
        assert result.content_type == "audio/wav"
        assert result.audio_size_bytes > 0
        assert result.text_length == len("Test synthesis.")
        assert result.generation_duration_ms >= 0
        assert result.sample_rate_hz == 22050
        fake_voice.synthesize_wav.assert_called_once()

    def test_length_scale_is_inverse_of_speaking_rate(self, tmp_path):
        onnx_path = tmp_path / "model.onnx"
        onnx_path.write_bytes(b"fake")
        config = _make_engine_config(model_path=str(onnx_path))
        provider = PiperTtsProvider("piper", config)

        captured = {}

        def fake_synthesize(text, wav_file, syn_config=None, **kwargs):
            captured["length_scale"] = getattr(syn_config, "length_scale", None)
            _fake_piper_synthesize(text, wav_file)

        fake_voice = MagicMock()
        fake_voice.synthesize_wav.side_effect = fake_synthesize
        mock_piper = MagicMock()
        mock_piper.PiperVoice.load.return_value = fake_voice
        mock_piper.SynthesisConfig = _FakeSynthesisConfig

        with patch.dict("sys.modules", {"piper": mock_piper}):
            provider.synthesize("Hello", speaking_rate=2.0)

        # speaking_rate=2.0 → length_scale=0.5
        assert captured["length_scale"] is not None
        assert abs(captured["length_scale"] - 0.5) < 0.001

    def test_normal_speaking_rate_passes_none_length_scale(self, tmp_path):
        onnx_path = tmp_path / "model.onnx"
        onnx_path.write_bytes(b"fake")
        config = _make_engine_config(model_path=str(onnx_path))
        provider = PiperTtsProvider("piper", config)

        captured = {}

        def fake_synthesize(text, wav_file, syn_config=None, **kwargs):
            captured["length_scale"] = getattr(syn_config, "length_scale", None)
            _fake_piper_synthesize(text, wav_file)

        fake_voice = MagicMock()
        fake_voice.synthesize_wav.side_effect = fake_synthesize
        mock_piper = MagicMock()
        mock_piper.PiperVoice.load.return_value = fake_voice
        mock_piper.SynthesisConfig = _FakeSynthesisConfig

        with patch.dict("sys.modules", {"piper": mock_piper}):
            provider.synthesize("Hello", speaking_rate=1.0)

        assert captured["length_scale"] is None

    def test_voice_id_overrides_model_path_from_options(self, tmp_path):
        override_path = tmp_path / "override.onnx"
        override_path.write_bytes(b"override_model")
        default_path = tmp_path / "default.onnx"
        default_path.write_bytes(b"default_model")

        config = _make_engine_config(model_path=str(default_path))
        provider = PiperTtsProvider("piper", config)

        loaded_paths: list[str] = []

        def fake_load(path):
            loaded_paths.append(path)
            fake_voice = MagicMock()
            fake_voice.synthesize_wav.side_effect = _fake_piper_synthesize
            return fake_voice

        mock_piper = MagicMock()
        mock_piper.PiperVoice.load.side_effect = fake_load
        mock_piper.SynthesisConfig = _FakeSynthesisConfig

        with patch.dict("sys.modules", {"piper": mock_piper}):
            result = provider.synthesize("Hello", voice_id=str(override_path))

        assert result.voice_id == str(override_path)
        assert str(override_path) in loaded_paths
        assert str(default_path) not in loaded_paths

    def test_voice_model_is_cached_on_second_call(self, tmp_path):
        onnx_path = tmp_path / "model.onnx"
        onnx_path.write_bytes(b"model")
        config = _make_engine_config(model_path=str(onnx_path))
        provider = PiperTtsProvider("piper", config)

        fake_voice = MagicMock()
        fake_voice.synthesize_wav.side_effect = _fake_piper_synthesize
        mock_piper = MagicMock()
        mock_piper.PiperVoice.load.return_value = fake_voice
        mock_piper.SynthesisConfig = _FakeSynthesisConfig

        with patch.dict("sys.modules", {"piper": mock_piper}):
            provider.synthesize("First call")
            provider.synthesize("Second call")

        # PiperVoice.load() should only be called once due to caching
        assert mock_piper.PiperVoice.load.call_count == 1


# ---------------------------------------------------------------------------
# CoquiXttsTtsProvider
# ---------------------------------------------------------------------------


class TestCoquiXttsTtsProvider:
    def test_raises_not_implemented_when_tts_package_missing(self):
        config = _make_engine_config(backend="coqui-xtts")
        provider = CoquiXttsTtsProvider("coqui-xtts", config)
        with patch.dict("sys.modules", {"TTS": None, "TTS.api": None}):
            with pytest.raises(TtsProviderNotImplementedError, match="TTS"):
                provider.synthesize("Hello world")


# ---------------------------------------------------------------------------
# ReservedTtsProvider
# ---------------------------------------------------------------------------


class TestReservedTtsProvider:
    def test_reserved_provider_raises_not_implemented(self):
        config = _make_engine_config(backend="future-engine")
        provider = ReservedTtsProvider("future-engine", config)
        with pytest.raises(TtsProviderNotImplementedError, match="future-engine"):
            provider.synthesize("Hello")


# ---------------------------------------------------------------------------
# TtsGateway
# ---------------------------------------------------------------------------


class TestTtsGateway:
    def setup_method(self):
        PiperTtsProvider._voice_cache.clear()

    def test_gateway_builds_enabled_providers(self):
        config = _make_tts_providers_config()
        gateway = TtsGateway(config)
        assert "piper" in gateway._providers

    def test_gateway_skips_disabled_providers(self):
        config = _make_tts_providers_config(
            engines={
                "piper": {
                    "enabled": False,
                    "backend": "piper",
                    "endpoint": "",
                    "model": "",
                    "api_key_env": "",
                    "language": "en",
                    "stream": False,
                    "options": {},
                }
            },
            default_engine="",
        )
        gateway = TtsGateway(config)
        assert "piper" not in gateway._providers

    def test_gateway_raises_when_no_default_engine_configured(self):
        config = _make_tts_providers_config(engines={}, default_engine="")
        gateway = TtsGateway(config)
        with pytest.raises(TtsProviderConfigurationError, match="No TTS engine"):
            gateway.synthesize_text("Hello")

    def test_gateway_raises_when_requested_engine_not_enabled(self):
        config = _make_tts_providers_config()
        gateway = TtsGateway(config)
        with pytest.raises(TtsProviderConfigurationError, match="not enabled"):
            gateway.synthesize_text("Hello", engine_id="coqui-xtts")

    def test_gateway_delegates_to_correct_provider(self):
        config = _make_tts_providers_config()
        gateway = TtsGateway(config)
        expected = _make_result()
        with patch.object(gateway._providers["piper"], "synthesize", return_value=expected):
            result = gateway.synthesize_text("Hello world")
        assert result is expected

    def test_gateway_passes_voice_params_to_provider(self):
        config = _make_tts_providers_config()
        gateway = TtsGateway(config)

        called_with: dict = {}

        def fake_synthesize(text, *, voice_id="", language="", speaking_rate=1.0, pitch=0.0):
            called_with.update(dict(
                voice_id=voice_id, language=language,
                speaking_rate=speaking_rate, pitch=pitch,
            ))
            return _make_result()

        with patch.object(gateway._providers["piper"], "synthesize", side_effect=fake_synthesize):
            gateway.synthesize_text(
                "Hello",
                voice_id="/models/en.onnx",
                language="en",
                speaking_rate=0.9,
                pitch=-0.1,
            )

        assert called_with["voice_id"] == "/models/en.onnx"
        assert called_with["language"] == "en"
        assert abs(called_with["speaking_rate"] - 0.9) < 0.001
        assert abs(called_with["pitch"] - -0.1) < 0.001

    def test_gateway_uses_explicit_engine_over_default(self):
        config = _make_tts_providers_config(
            engines={
                "piper": {
                    "enabled": True,
                    "backend": "piper",
                    "endpoint": "",
                    "model": "",
                    "api_key_env": "",
                    "language": "en",
                    "stream": False,
                    "options": {},
                },
                "coqui-xtts": {
                    "enabled": True,
                    "backend": "coqui-xtts",
                    "endpoint": "",
                    "model": "",
                    "api_key_env": "",
                    "language": "en",
                    "stream": True,
                    "options": {},
                },
            },
            default_engine="piper",
        )
        gateway = TtsGateway(config)
        expected = _make_result(engine_id="coqui-xtts", engine_backend="coqui-xtts")
        with patch.object(gateway._providers["coqui-xtts"], "synthesize", return_value=expected):
            result = gateway.synthesize_text("Hello", engine_id="coqui-xtts")
        assert result.engine_id == "coqui-xtts"


# ---------------------------------------------------------------------------
# API endpoint: POST /api/v1/conversation/tts
# ---------------------------------------------------------------------------


class TestTtsSynthesisEndpoint:
    def test_synthesize_returns_audio_base64(self, client):
        fake_audio = b"RIFF\x00\x00\x00\x00WAVEfmt "
        fake_result = _make_result(audio_bytes=fake_audio, audio_size_bytes=len(fake_audio))
        context = client.app.state.app_context
        with patch.object(context.tts, "synthesize_text", return_value=fake_result):
            response = client.post(
                "/api/v1/conversation/tts",
                json={"text": "Hello world"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["engine"]["id"] == "piper"
        assert "audio_base64" in data["audio"]
        assert base64.b64decode(data["audio"]["audio_base64"]) == fake_audio
        assert data["dry_run"]["enabled"] is False

    def test_response_structure_is_complete(self, client):
        fake_result = _make_result()
        context = client.app.state.app_context
        with patch.object(context.tts, "synthesize_text", return_value=fake_result):
            response = client.post("/api/v1/conversation/tts", json={"text": "Hello"})
        assert response.status_code == 200
        data = response.json()
        assert "engine" in data
        assert "id" in data["engine"]
        assert "backend" in data["engine"]
        assert "voice_id" in data["engine"]
        assert "synthesis" in data
        assert "text_length" in data["synthesis"]
        assert "language" in data["synthesis"]
        assert "speaking_rate" in data["synthesis"]
        assert "pitch" in data["synthesis"]
        assert "audio" in data
        assert "timings" in data
        assert "generation_ms" in data["timings"]
        assert "total_ms" in data["timings"]

    def test_dry_run_excludes_audio_base64(self, client):
        fake_result = _make_result(audio_bytes=b"WAV_DATA", audio_size_bytes=8)
        context = client.app.state.app_context
        with patch.object(context.tts, "synthesize_text", return_value=fake_result):
            response = client.post(
                "/api/v1/conversation/tts",
                json={"text": "Hello world", "dry_run": True},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["dry_run"]["enabled"] is True
        assert "audio_base64" not in data["audio"]
        assert data["audio"]["size_bytes"] == 8

    def test_persona_voice_settings_applied(self, client):
        context = client.app.state.app_context
        persona_id = context.config.personas.default_persona_id
        persona = next(p for p in context.config.personas.personas if p.id == persona_id)
        expected_rate = persona.voice.speaking_rate

        captured: dict = {}

        def fake_synthesize(text, engine_id="", voice_id="", language="", speaking_rate=1.0, pitch=0.0):
            captured["speaking_rate"] = speaking_rate
            captured["voice_id"] = voice_id
            return _make_result()

        with patch.object(context.tts, "synthesize_text", side_effect=fake_synthesize):
            response = client.post(
                "/api/v1/conversation/tts",
                json={"text": "Hello", "persona_id": persona_id},
            )

        assert response.status_code == 200
        assert abs(captured["speaking_rate"] - expected_rate) < 0.001
        data = response.json()
        assert data["persona_id"] == persona_id
        assert data["persona_name"] == persona.name

    def test_explicit_speaking_rate_overrides_persona(self, client):
        context = client.app.state.app_context
        persona_id = context.config.personas.default_persona_id

        captured: dict = {}

        def fake_synthesize(text, engine_id="", voice_id="", language="", speaking_rate=1.0, pitch=0.0):
            captured["speaking_rate"] = speaking_rate
            return _make_result()

        with patch.object(context.tts, "synthesize_text", side_effect=fake_synthesize):
            client.post(
                "/api/v1/conversation/tts",
                json={"text": "Hello", "persona_id": persona_id, "speaking_rate": 1.5},
            )

        assert abs(captured["speaking_rate"] - 1.5) < 0.001

    def test_invalid_persona_returns_400(self, client):
        response = client.post(
            "/api/v1/conversation/tts",
            json={"text": "Hello", "persona_id": "nonexistent-persona-xyz"},
        )
        assert response.status_code == 400
        assert "nonexistent-persona-xyz" in response.json()["detail"]

    def test_empty_text_returns_422(self, client):
        response = client.post("/api/v1/conversation/tts", json={"text": ""})
        assert response.status_code == 422

    def test_speaking_rate_out_of_range_returns_422(self, client):
        response = client.post(
            "/api/v1/conversation/tts",
            json={"text": "Hello", "speaking_rate": 99.0},
        )
        assert response.status_code == 422

    def test_tts_provider_error_returns_502(self, client):
        from app.providers.tts import TtsProviderConfigurationError

        context = client.app.state.app_context
        with patch.object(
            context.tts,
            "synthesize_text",
            side_effect=TtsProviderConfigurationError("Piper model not found"),
        ):
            response = client.post("/api/v1/conversation/tts", json={"text": "Hello"})
        assert response.status_code == 502
        assert "Piper model not found" in response.json()["detail"]

    def test_engine_id_override_passed_through(self, client):
        context = client.app.state.app_context
        captured: dict = {}

        def fake_synthesize(text, engine_id="", **kwargs):
            captured["engine_id"] = engine_id
            return _make_result()

        with patch.object(context.tts, "synthesize_text", side_effect=fake_synthesize):
            client.post(
                "/api/v1/conversation/tts",
                json={"text": "Hello", "engine_id": "coqui-xtts"},
            )

        assert captured["engine_id"] == "coqui-xtts"

    def test_no_persona_uses_defaults(self, client):
        context = client.app.state.app_context
        captured: dict = {}

        def fake_synthesize(text, engine_id="", voice_id="", language="", speaking_rate=1.0, pitch=0.0):
            captured.update(dict(
                engine_id=engine_id, voice_id=voice_id,
                speaking_rate=speaking_rate, pitch=pitch,
            ))
            return _make_result()

        with patch.object(context.tts, "synthesize_text", side_effect=fake_synthesize):
            response = client.post("/api/v1/conversation/tts", json={"text": "Hello"})

        assert response.status_code == 200
        assert captured["engine_id"] == ""
        assert captured["speaking_rate"] == 1.0
        assert captured["pitch"] == 0.0
        data = response.json()
        assert data["persona_id"] == ""
        assert data["persona_name"] == ""
