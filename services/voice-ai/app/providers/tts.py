"""TTS gateway and provider implementations for deep-space-voice."""

from __future__ import annotations

import io
import logging
import time
import wave
from dataclasses import dataclass, field
from typing import Optional

from app.config.models import EngineConnectionConfig, TtsProvidersConfig

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------


@dataclass
class TtsExecutionResult:
    audio_bytes: bytes
    content_type: str
    engine_id: str
    engine_backend: str
    voice_id: str
    language: str
    text_length: int
    audio_size_bytes: int
    generation_duration_ms: float
    total_duration_ms: float
    sample_rate_hz: int = 22050
    channels: int = 1
    sample_width: int = 2  # 16-bit PCM


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class TtsProviderError(RuntimeError):
    """Base TTS provider error."""


class TtsProviderConfigurationError(TtsProviderError):
    """Missing or invalid provider configuration."""


class TtsProviderRequestError(TtsProviderError):
    """Error during audio synthesis."""


class TtsProviderNotImplementedError(TtsProviderError):
    """Provider backend not yet implemented."""


class TtsExecutionError(TtsProviderError):
    """Unrecoverable synthesis failure."""


# ---------------------------------------------------------------------------
# Base provider
# ---------------------------------------------------------------------------


class _TtsProvider:
    def __init__(self, engine_id: str, config: EngineConnectionConfig) -> None:
        self._engine_id = engine_id
        self._config = config

    def synthesize(
        self,
        text: str,
        *,
        voice_id: str = "",
        language: str = "",
        speaking_rate: float = 1.0,
        pitch: float = 0.0,
    ) -> TtsExecutionResult:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Piper provider
# ---------------------------------------------------------------------------


class PiperTtsProvider(_TtsProvider):
    """Local TTS using the piper-tts Python package.

    Requirements:
    - ``pip install piper-tts`` (available on Linux/Docker; use piper binary on Windows)
    - A Piper voice model (.onnx) from https://github.com/rhasspy/piper/releases
    - Set ``options.model_path`` in providers.json under ``tts.engines.piper``
      (or set ``voice.voice_id`` on a persona to override per persona).

    speaking_rate maps to Piper's length_scale as: length_scale = 1.0 / speaking_rate
    Pitch adjustment is not supported natively by Piper's ONNX inference.
    """

    _voice_cache: dict[str, object] = {}

    def _load_voice(self, model_path: str) -> object:
        if model_path in self._voice_cache:
            return self._voice_cache[model_path]

        try:
            from piper import PiperVoice  # type: ignore[import]
        except ImportError as exc:
            raise TtsProviderConfigurationError(
                "piper-tts Python package is not installed. "
                "Run 'pip install piper-tts' inside the Docker container. "
                "On Windows outside Docker, install the Piper binary from "
                "https://github.com/rhasspy/piper/releases instead."
            ) from exc

        import os

        if not os.path.isfile(model_path):
            raise TtsProviderConfigurationError(
                f"Piper voice model not found: {model_path!r}. "
                "Download a .onnx voice model from "
                "https://github.com/rhasspy/piper/releases and set "
                "'options.model_path' in the piper TTS engine (providers.json), "
                "or set 'voice.voice_id' on the active persona."
            )

        try:
            voice = PiperVoice.load(model_path)
            self._voice_cache[model_path] = voice
            log.info("Piper voice model loaded and cached: %s", model_path)
            return voice
        except Exception as exc:
            raise TtsProviderConfigurationError(
                f"Failed to load Piper model {model_path!r}: {exc}"
            ) from exc

    def synthesize(
        self,
        text: str,
        *,
        voice_id: str = "",
        language: str = "",
        speaking_rate: float = 1.0,
        pitch: float = 0.0,
    ) -> TtsExecutionResult:
        t_start = time.perf_counter()

        # voice_id acts as model_path override to support per-persona voices
        model_path = voice_id or self._config.options.get("model_path", "")
        if not model_path:
            raise TtsProviderConfigurationError(
                "Piper requires a voice model file. "
                "Set 'options.model_path' in the piper engine (providers.json) "
                "to a downloaded .onnx file path, or set 'voice.voice_id' on "
                "the active persona to override it per persona. "
                "Download models from https://github.com/rhasspy/piper/releases"
            )

        voice = self._load_voice(model_path)

        # piper-tts >= 1.2 uses SynthesisConfig to control inference parameters.
        # length_scale is the inverse of speaking_rate:
        #   speaking_rate=2.0 → length_scale=0.5 (twice as fast)
        #   speaking_rate=0.5 → length_scale=2.0 (twice as slow)
        try:
            from piper import SynthesisConfig  # type: ignore[import]
            syn_config: Optional[object] = None
            if speaking_rate and speaking_rate != 1.0:
                length_scale = 1.0 / max(speaking_rate, 0.1)
                syn_config = SynthesisConfig(length_scale=length_scale)
        except ImportError:
            # Older piper-tts builds that lack SynthesisConfig — proceed without rate control.
            syn_config = None

        buf = io.BytesIO()
        t_gen = time.perf_counter()
        try:
            with wave.open(buf, "wb") as wav_file:
                if syn_config is not None:
                    voice.synthesize_wav(text, wav_file, syn_config=syn_config)
                else:
                    voice.synthesize_wav(text, wav_file)
        except Exception as exc:
            raise TtsProviderRequestError(f"Piper synthesis failed: {exc}") from exc

        gen_ms = (time.perf_counter() - t_gen) * 1000.0
        total_ms = (time.perf_counter() - t_start) * 1000.0
        audio = buf.getvalue()
        sample_rate = int(self._config.options.get("sample_rate_hz", 22050))
        resolved_lang = language or self._config.language

        log.info(
            "Piper TTS | engine=%s model=%s lang=%s chars=%d size=%d bytes "
            "gen=%.0fms total=%.0fms",
            self._engine_id,
            model_path,
            resolved_lang,
            len(text),
            len(audio),
            gen_ms,
            total_ms,
        )

        return TtsExecutionResult(
            audio_bytes=audio,
            content_type="audio/wav",
            engine_id=self._engine_id,
            engine_backend="piper",
            voice_id=model_path,
            language=resolved_lang,
            text_length=len(text),
            audio_size_bytes=len(audio),
            generation_duration_ms=gen_ms,
            total_duration_ms=total_ms,
            sample_rate_hz=sample_rate,
        )


# ---------------------------------------------------------------------------
# Coqui / XTTS provider (functional placeholder)
# ---------------------------------------------------------------------------


class CoquiXttsTtsProvider(_TtsProvider):
    """TTS using Coqui XTTS v2 — functional placeholder, full implementation deferred.

    Requires the heavy 'TTS' package (coqui-ai/TTS) which pulls PyTorch and
    several GB of model weights.  Install it only if you need expressive or
    cloneable voices that Piper cannot provide.

    Enable by installing: ``pip install TTS``
    Then set ``tts.engines.coqui-xtts.model`` to the Coqui model name in
    providers.json (defaults to xtts_v2 when left empty).
    """

    def synthesize(
        self,
        text: str,
        *,
        voice_id: str = "",
        language: str = "",
        speaking_rate: float = 1.0,
        pitch: float = 0.0,
    ) -> TtsExecutionResult:
        try:
            from TTS.api import TTS as CoquiTTS  # type: ignore[import]
        except ImportError as exc:
            raise TtsProviderNotImplementedError(
                "Coqui XTTS requires the 'TTS' package (coqui-ai/TTS). "
                "Run 'pip install TTS' — note: this pulls PyTorch and several GB. "
                "Use the 'piper' engine as the lighter alternative. "
                "See https://github.com/coqui-ai/TTS for details."
            ) from exc

        model_name = self._config.model or "tts_models/multilingual/multi-dataset/xtts_v2"
        lang = language or self._config.language or "en"

        t_start = time.perf_counter()
        try:
            tts_engine = CoquiTTS(model_name)
            wav_samples = tts_engine.tts(text=text, language=lang)
        except Exception as exc:
            raise TtsProviderRequestError(f"Coqui XTTS synthesis failed: {exc}") from exc

        gen_ms = (time.perf_counter() - t_start) * 1000.0
        audio_bytes = _floats_to_wav(wav_samples, sample_rate=24000)
        total_ms = (time.perf_counter() - t_start) * 1000.0

        log.info(
            "Coqui XTTS | engine=%s model=%s lang=%s chars=%d gen=%.0fms total=%.0fms",
            self._engine_id,
            model_name,
            lang,
            len(text),
            gen_ms,
            total_ms,
        )

        return TtsExecutionResult(
            audio_bytes=audio_bytes,
            content_type="audio/wav",
            engine_id=self._engine_id,
            engine_backend="coqui-xtts",
            voice_id=voice_id or model_name,
            language=lang,
            text_length=len(text),
            audio_size_bytes=len(audio_bytes),
            generation_duration_ms=gen_ms,
            total_duration_ms=total_ms,
            sample_rate_hz=24000,
        )


def _floats_to_wav(samples: list, sample_rate: int = 24000) -> bytes:
    """Convert float audio samples in [-1, 1] to 16-bit PCM WAV bytes."""
    import array

    pcm = array.array("h", [max(-32768, min(32767, int(s * 32767))) for s in samples])
    buf = io.BytesIO()
    with wave.open(buf, "w") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm.tobytes())
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Reserved placeholder
# ---------------------------------------------------------------------------


class ReservedTtsProvider(_TtsProvider):
    """Placeholder for unknown or future TTS backends."""

    def synthesize(self, text: str, **kwargs) -> TtsExecutionResult:
        raise TtsProviderNotImplementedError(
            f"TTS backend '{self._config.backend}' is not implemented."
        )


# ---------------------------------------------------------------------------
# Gateway
# ---------------------------------------------------------------------------


_BACKEND_MAP: dict[str, type] = {
    "piper": PiperTtsProvider,
    "coqui-xtts": CoquiXttsTtsProvider,
}


class TtsGateway:
    """Orchestrates TTS engine selection and text-to-audio synthesis."""

    def __init__(self, config: TtsProvidersConfig) -> None:
        self._config = config
        self._providers: dict[str, _TtsProvider] = {}
        self._build_providers()

    def _build_providers(self) -> None:
        for engine_id, engine_cfg in self._config.engines.items():
            if not engine_cfg.enabled:
                continue
            cls = _BACKEND_MAP.get(engine_cfg.backend, ReservedTtsProvider)
            self._providers[engine_id] = cls(engine_id, engine_cfg)

    def synthesize_text(
        self,
        text: str,
        engine_id: str = "",
        voice_id: str = "",
        language: str = "",
        speaking_rate: float = 1.0,
        pitch: float = 0.0,
    ) -> TtsExecutionResult:
        """Synthesize text into audio using the configured or requested engine.

        Args:
            text: Text to synthesize.
            engine_id: Engine to use (empty → use configured default_engine).
            voice_id: Voice model path override for Piper, or voice identifier.
                      Overrides persona voice_id if both are supplied.
            language: Language code override.
            speaking_rate: Rate multiplier (1.0 normal, >1 faster, <1 slower).
            pitch: Pitch shift hint (0.0 neutral; support varies by engine).
        """
        target = engine_id or self._config.default_engine
        if not target:
            raise TtsProviderConfigurationError(
                "No TTS engine is configured. "
                "Set 'tts.default_engine' in providers.json."
            )

        provider = self._providers.get(target)
        if provider is None:
            enabled = list(self._providers)
            raise TtsProviderConfigurationError(
                f"TTS engine '{target}' is not enabled. "
                f"Enabled engines: {enabled or ['none']}"
            )

        try:
            return provider.synthesize(
                text,
                voice_id=voice_id,
                language=language,
                speaking_rate=speaking_rate,
                pitch=pitch,
            )
        except TtsProviderError:
            raise
        except Exception as exc:
            raise TtsExecutionError(
                f"Unexpected error in TTS engine '{target}': {exc}"
            ) from exc
