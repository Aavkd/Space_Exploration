from __future__ import annotations

import logging
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

from app.config.models import SttProvidersConfig

try:
    from faster_whisper import WhisperModel
except ImportError:  # pragma: no cover - exercised through runtime configuration errors
    WhisperModel = None

try:
    from faster_whisper import decode_audio
except ImportError:  # pragma: no cover - exercised through runtime configuration errors
    decode_audio = None


logger = logging.getLogger(__name__)

_AUDIO_SUFFIX_BY_CONTENT_TYPE = {
    "audio/flac": ".flac",
    "audio/m4a": ".m4a",
    "audio/mp3": ".mp3",
    "audio/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/webm": ".webm",
    "video/webm": ".webm",
}
_KNOWN_AUDIO_SUFFIXES = {".flac", ".m4a", ".mp3", ".mp4", ".ogg", ".wav", ".webm"}
_RESERVED_STT_BACKENDS = {"openai"}


@dataclass(slots=True)
class SttExecutionResult:
    text: str
    language: str
    language_probability: float
    language_supported: bool
    engine_id: str
    engine_backend: str
    model: str
    audio_duration_seconds: float
    audio_size_bytes: int
    content_type: str
    transcription_duration_ms: float
    total_duration_ms: float


class SttProviderError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        engine_id: str,
        engine_backend: str,
        model: str,
    ) -> None:
        super().__init__(message)
        self.engine_id = engine_id
        self.engine_backend = engine_backend
        self.model = model


class SttProviderConfigurationError(SttProviderError):
    """Raised when an STT engine is selected with an unusable configuration."""


class SttProviderRequestError(SttProviderError):
    """Raised when an STT engine fails to transcribe audio."""


class SttProviderNotImplementedError(SttProviderError):
    """Raised when a configured backend has no implementation yet."""


class SttExecutionError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        engine_id: str,
        engine_backend: str,
        model: str,
    ) -> None:
        super().__init__(message)
        self.engine_id = engine_id
        self.engine_backend = engine_backend
        self.model = model


class SttProvider(Protocol):
    engine_id: str
    engine_backend: str
    model: str

    def transcribe(
        self,
        audio_path: Path,
        *,
        supported_languages: list[str],
    ) -> tuple[str, str, float, bool, float, float]:
        """Return text, detected language, confidence, support flag, audio duration and engine duration."""


class BaseSttProvider:
    def __init__(self, engine_id: str, backend: str, model: str, language: str, options: dict[str, Any]) -> None:
        self.engine_id = engine_id
        self.engine_backend = backend
        self.model = model.strip()
        self.language = language.strip().lower()
        self.options = dict(options)

    def _raise_configuration_error(self, message: str) -> None:
        raise SttProviderConfigurationError(
            message,
            engine_id=self.engine_id,
            engine_backend=self.engine_backend,
            model=self.model,
        )

    def _raise_request_error(self, message: str) -> None:
        raise SttProviderRequestError(
            message,
            engine_id=self.engine_id,
            engine_backend=self.engine_backend,
            model=self.model,
        )

    def _raise_not_implemented_error(self, message: str) -> None:
        raise SttProviderNotImplementedError(
            message,
            engine_id=self.engine_id,
            engine_backend=self.engine_backend,
            model=self.model,
        )

    def _require_model(self) -> None:
        if not self.model:
            self._raise_configuration_error(f"STT engine '{self.engine_id}' must define a model in config.")


class FasterWhisperSttProvider(BaseSttProvider):
    _model_cache: dict[tuple[str, str, str, str], Any] = {}

    def transcribe(
        self,
        audio_path: Path,
        *,
        supported_languages: list[str],
    ) -> tuple[str, str, float, bool, float, float]:
        model = self._get_model()

        normalized_languages = [language.strip().lower() for language in supported_languages if language.strip()]
        requested_language = self.language if self.language and self.language != "auto" else None

        # When the language is left to auto-detection, Whisper inspects only the first 30s window of the
        # raw signal. Short browser captures often start with silence/breath, so the base model falls back
        # to its strong English prior and never reports French. Run an explicit, VAD-filtered detection
        # restricted to the configured languages so French is actually compared against English.
        detection_probability: float | None = None
        if requested_language is None and normalized_languages:
            requested_language, detection_probability = self._detect_supported_language(
                model,
                audio_path,
                normalized_languages,
            )

        transcribe_kwargs: dict[str, Any] = {
            "beam_size": int(self.options.get("beam_size", 5)),
            "condition_on_previous_text": bool(self.options.get("condition_on_previous_text", False)),
            "task": "transcribe",
            "vad_filter": bool(self.options.get("vad_filter", False)),
        }
        if requested_language:
            transcribe_kwargs["language"] = requested_language

        started_at = time.perf_counter()
        try:
            segments, info = model.transcribe(str(audio_path), **transcribe_kwargs)
            text = " ".join(segment.text.strip() for segment in segments if getattr(segment, "text", "").strip()).strip()
        except Exception as exc:  # pragma: no cover - exercised through tests with fake providers and runtime integration
            self._raise_request_error(f"STT engine '{self.engine_id}' failed to transcribe audio: {exc}")

        if not text:
            self._raise_request_error(f"STT engine '{self.engine_id}' returned an empty transcript.")

        detected_language = (requested_language or getattr(info, "language", "") or "").strip().lower()
        # When we forced the language from the explicit detection pass, info.language_probability is ~1.0
        # (the model was told the language), so the detection confidence is the meaningful value to report.
        if detection_probability is not None:
            language_probability = detection_probability
        else:
            language_probability = float(getattr(info, "language_probability", 0.0) or 0.0)
        language_supported = not normalized_languages or detected_language in normalized_languages
        audio_duration_seconds = float(getattr(info, "duration", 0.0) or 0.0)
        duration_ms = (time.perf_counter() - started_at) * 1000

        if detected_language and normalized_languages and not language_supported:
            logger.warning(
                "STT detected language outside configured support engine=%s detected=%s supported=%s",
                self.engine_id,
                detected_language,
                ",".join(normalized_languages),
            )

        return (
            text,
            detected_language,
            language_probability,
            language_supported,
            audio_duration_seconds,
            duration_ms,
        )

    def _detect_supported_language(
        self,
        model: Any,
        audio_path: Path,
        supported_languages: list[str],
    ) -> tuple[str | None, float | None]:
        """Detect the spoken language constrained to the configured set.

        Returns the chosen language and its probability, or ``(None, None)`` to fall back to Whisper's
        built-in auto-detection (older faster-whisper builds without ``detect_language`` or detection errors).
        """
        detector = getattr(model, "detect_language", None)
        if not callable(detector) or decode_audio is None:
            return None, None

        # detect_language expects a decoded 16kHz mono float array, not a file path.
        try:
            audio = decode_audio(str(audio_path), sampling_rate=16000)
        except Exception as exc:  # pragma: no cover - depends on local runtime/codec availability
            logger.warning(
                "STT language detection could not decode audio, falling back to auto engine=%s error=%s",
                self.engine_id,
                exc,
            )
            return None, None

        # VAD filtering drops the leading silence/noise that biases detection toward English, and scanning a
        # couple of segments makes detection robust on short browser captures. Retry with the legacy
        # signature for faster-whisper builds that do not accept these kwargs.
        detection_segments = int(self.options.get("language_detection_segments", 2))
        try:
            result = detector(
                audio,
                vad_filter=True,
                language_detection_segments=detection_segments,
            )
        except TypeError:
            try:
                result = detector(audio)
            except Exception as exc:  # pragma: no cover - depends on local runtime/model behaviour
                logger.warning(
                    "STT language detection failed, falling back to auto engine=%s error=%s",
                    self.engine_id,
                    exc,
                )
                return None, None
        except Exception as exc:  # pragma: no cover - depends on local runtime/model behaviour
            logger.warning(
                "STT language detection failed, falling back to auto engine=%s error=%s",
                self.engine_id,
                exc,
            )
            return None, None

        if not isinstance(result, tuple) or not result:
            return None, None

        # faster-whisper returns (language, probability, all_language_probs); older builds return only the pair.
        all_probs = result[2] if len(result) >= 3 and result[2] else None
        if all_probs:
            candidates = [
                (str(language).strip().lower(), float(probability))
                for language, probability in all_probs
            ]
        else:
            candidates = [(str(result[0]).strip().lower(), float(result[1]))]

        supported_candidates = [
            (language, probability) for language, probability in candidates if language in supported_languages
        ]
        if not supported_candidates:
            return None, None

        best_language, best_probability = max(supported_candidates, key=lambda item: item[1])
        logger.info(
            "STT language detection engine=%s chosen=%s probability=%.4f candidates=%s",
            self.engine_id,
            best_language,
            best_probability,
            ",".join(f"{language}:{probability:.2f}" for language, probability in supported_candidates),
        )
        return best_language, best_probability

    def _get_model(self) -> Any:
        if WhisperModel is None:
            self._raise_configuration_error(
                "faster-whisper is not installed. Add it to the environment before using the local STT pipeline."
            )

        self._require_model()

        device = str(self.options.get("device", "auto"))
        compute_type = str(self.options.get("compute_type", "default"))
        download_root = str(self.options.get("download_root", ""))
        cache_key = (self.model, device, compute_type, download_root)
        cached_model = self._model_cache.get(cache_key)
        if cached_model is not None:
            return cached_model

        init_kwargs: dict[str, Any] = {
            "device": device,
            "compute_type": compute_type,
        }
        if download_root:
            init_kwargs["download_root"] = download_root
        if "cpu_threads" in self.options:
            init_kwargs["cpu_threads"] = int(self.options["cpu_threads"])
        if "num_workers" in self.options:
            init_kwargs["num_workers"] = int(self.options["num_workers"])
        if "local_files_only" in self.options:
            init_kwargs["local_files_only"] = bool(self.options["local_files_only"])

        try:
            model = WhisperModel(self.model, **init_kwargs)
        except Exception as exc:  # pragma: no cover - depends on local runtime/model install
            self._raise_configuration_error(
                f"Unable to initialize faster-whisper model '{self.model}' for engine '{self.engine_id}': {exc}"
            )

        self._model_cache[cache_key] = model
        return model


class ReservedSttProvider(BaseSttProvider):
    def transcribe(
        self,
        audio_path: Path,
        *,
        supported_languages: list[str],
    ) -> tuple[str, str, float, bool, float, float]:
        del audio_path, supported_languages
        self._raise_not_implemented_error(
            f"STT backend '{self.engine_backend}' is reserved for engine '{self.engine_id}' but is not implemented yet."
        )


class SttGateway:
    def __init__(
        self,
        config: SttProvidersConfig,
        *,
        supported_languages: list[str],
        debug_audio_capture: bool = False,
    ) -> None:
        self._config = config
        self._supported_languages = [language.strip().lower() for language in supported_languages if language.strip()]
        self._debug_audio_capture = debug_audio_capture

    def transcribe_audio(
        self,
        audio_bytes: bytes,
        *,
        content_type: str = "",
        filename: str = "",
        engine_id: str = "",
    ) -> SttExecutionResult:
        if not audio_bytes:
            raise ValueError("Audio payload is empty.")

        active_engine_id = engine_id or self._config.default_engine
        if not active_engine_id:
            raise SttExecutionError(
                "No active STT engine is configured.",
                engine_id="",
                engine_backend="unknown",
                model="",
            )

        provider = self._create_provider(active_engine_id)
        normalized_content_type = content_type.split(";", 1)[0].strip().lower()
        safe_filename = Path(filename or "browser-capture").name
        suffix = self._guess_audio_suffix(safe_filename, normalized_content_type)

        total_started_at = time.perf_counter()
        logger.info(
            "STT request started engine=%s backend=%s model=%s content_type=%s bytes=%s",
            provider.engine_id,
            provider.engine_backend,
            provider.model or "<unset>",
            normalized_content_type or "application/octet-stream",
            len(audio_bytes),
        )

        try:
            with tempfile.TemporaryDirectory(prefix="deep-space-voice-stt-") as temp_dir:
                audio_path = Path(temp_dir) / f"input{suffix}"
                audio_path.write_bytes(audio_bytes)
                self._persist_debug_audio(audio_path, suffix=suffix)
                (
                    text,
                    language,
                    language_probability,
                    language_supported,
                    audio_duration_seconds,
                    transcription_duration_ms,
                ) = provider.transcribe(audio_path, supported_languages=self._supported_languages)
        except ValueError:
            raise
        except SttProviderError as exc:
            raise SttExecutionError(
                f"STT request failed on engine '{exc.engine_id}': {exc}",
                engine_id=exc.engine_id,
                engine_backend=exc.engine_backend,
                model=exc.model,
            ) from exc

        total_duration_ms = (time.perf_counter() - total_started_at) * 1000
        logger.info(
            "STT request succeeded engine=%s backend=%s model=%s language=%s supported=%s total_duration_ms=%.2f",
            provider.engine_id,
            provider.engine_backend,
            provider.model or "<unset>",
            language or "<unknown>",
            language_supported,
            total_duration_ms,
        )
        return SttExecutionResult(
            text=text,
            language=language,
            language_probability=language_probability,
            language_supported=language_supported,
            engine_id=provider.engine_id,
            engine_backend=provider.engine_backend,
            model=provider.model,
            audio_duration_seconds=audio_duration_seconds,
            audio_size_bytes=len(audio_bytes),
            content_type=normalized_content_type or "application/octet-stream",
            transcription_duration_ms=transcription_duration_ms,
            total_duration_ms=total_duration_ms,
        )

    def _create_provider(self, engine_id: str) -> SttProvider:
        engine_config = self._config.engines.get(engine_id)
        if engine_config is None:
            raise SttExecutionError(
                f"STT engine '{engine_id}' is not declared in stt.engines.",
                engine_id=engine_id,
                engine_backend="unknown",
                model="",
            )
        if not engine_config.enabled:
            raise SttExecutionError(
                f"STT engine '{engine_id}' is disabled in config.",
                engine_id=engine_id,
                engine_backend=engine_config.backend,
                model=engine_config.model,
            )

        if engine_config.backend == "faster-whisper":
            return FasterWhisperSttProvider(
                engine_id,
                engine_config.backend,
                engine_config.model,
                engine_config.language,
                engine_config.options,
            )
        if engine_config.backend in _RESERVED_STT_BACKENDS:
            return ReservedSttProvider(
                engine_id,
                engine_config.backend,
                engine_config.model,
                engine_config.language,
                engine_config.options,
            )

        raise SttExecutionError(
            f"STT engine '{engine_id}' uses unsupported backend '{engine_config.backend}'.",
            engine_id=engine_id,
            engine_backend=engine_config.backend,
            model=engine_config.model,
        )

    def _persist_debug_audio(self, audio_path: Path, *, suffix: str) -> None:
        if not self._debug_audio_capture:
            return

        debug_dir = Path(tempfile.gettempdir()) / "deep-space-voice" / "debug-audio"
        debug_dir.mkdir(parents=True, exist_ok=True)
        debug_path = debug_dir / f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:8]}{suffix}"
        shutil.copy2(audio_path, debug_path)
        logger.info("STT debug audio capture saved path=%s", debug_path)

    @staticmethod
    def _guess_audio_suffix(filename: str, content_type: str) -> str:
        suffix = Path(filename).suffix.lower()
        if suffix in _KNOWN_AUDIO_SUFFIXES:
            return suffix
        return _AUDIO_SUFFIX_BY_CONTENT_TYPE.get(content_type, ".webm")
