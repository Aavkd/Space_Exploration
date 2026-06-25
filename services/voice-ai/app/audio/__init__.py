"""Audio pipeline package for capture, normalization, and streaming."""
from __future__ import annotations

import io
import math
import re
import time
import wave
from dataclasses import dataclass, field

from app.config.models import VoiceConfig, VoiceModeName


@dataclass(slots=True)
class VadAnalysisResult:
    speech_detected: bool
    silence_detected: bool
    rms: float
    peak: float
    duration_ms: int
    threshold: float
    source_format: str
    reason: str

    def as_dict(self) -> dict[str, object]:
        return {
            "speech_detected": self.speech_detected,
            "silence_detected": self.silence_detected,
            "rms": round(self.rms, 6),
            "peak": round(self.peak, 6),
            "duration_ms": self.duration_ms,
            "threshold": self.threshold,
            "source_format": self.source_format,
            "reason": self.reason,
        }


@dataclass(slots=True)
class WakeWordResult:
    enabled: bool
    phrase: str
    detected: bool
    confidence: float
    transcript: str

    def as_dict(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "phrase": self.phrase,
            "detected": self.detected,
            "confidence": round(self.confidence, 4),
            "transcript": self.transcript,
        }


@dataclass(slots=True)
class VoiceSessionState:
    session_id: str
    mode: VoiceModeName
    activated: bool = False
    assistant_speaking: bool = False
    last_activity_at: float = field(default_factory=time.time)
    last_wake_at: float = 0.0


class AudioActivityDetector:
    """Small VAD for prototype gating.

    PCM WAV input is measured using true normalized amplitude. Browser formats
    such as WebM cannot be decoded without ffmpeg here, so they use a conservative
    byte-size fallback that only gates empty/tiny payloads before STT.
    """

    def __init__(self, voice: VoiceConfig) -> None:
        self.voice = voice

    def analyze(self, audio_bytes: bytes, *, content_type: str = "") -> VadAnalysisResult:
        vad = self.voice.modes.vad
        if not audio_bytes:
            return VadAnalysisResult(
                speech_detected=False,
                silence_detected=True,
                rms=0.0,
                peak=0.0,
                duration_ms=0,
                threshold=vad.threshold,
                source_format="empty",
                reason="empty_audio",
            )

        normalized_content_type = content_type.split(";", 1)[0].strip().lower()
        if normalized_content_type == "audio/wav" or audio_bytes[:4] == b"RIFF":
            wav_result = self._analyze_wav(audio_bytes)
            if wav_result is not None:
                return wav_result

        speech_detected = len(audio_bytes) >= vad.fallback_min_bytes
        return VadAnalysisResult(
            speech_detected=speech_detected,
            silence_detected=not speech_detected,
            rms=0.0,
            peak=0.0,
            duration_ms=0,
            threshold=vad.threshold,
            source_format=normalized_content_type or "binary",
            reason="compressed_audio_size_gate" if speech_detected else "payload_below_fallback_min_bytes",
        )

    def _analyze_wav(self, audio_bytes: bytes) -> VadAnalysisResult | None:
        vad = self.voice.modes.vad
        try:
            with wave.open(io.BytesIO(audio_bytes), "rb") as wav_file:
                channels = wav_file.getnchannels()
                sample_width = wav_file.getsampwidth()
                frame_rate = wav_file.getframerate()
                frame_count = wav_file.getnframes()
                raw_frames = wav_file.readframes(frame_count)
        except (wave.Error, EOFError):
            return None

        if not raw_frames or frame_rate <= 0 or sample_width not in {1, 2, 4}:
            return VadAnalysisResult(
                speech_detected=False,
                silence_detected=True,
                rms=0.0,
                peak=0.0,
                duration_ms=0,
                threshold=vad.threshold,
                source_format="wav",
                reason="unsupported_or_empty_wav",
            )

        sample_count = len(raw_frames) // sample_width
        if sample_count <= 0:
            return VadAnalysisResult(
                speech_detected=False,
                silence_detected=True,
                rms=0.0,
                peak=0.0,
                duration_ms=0,
                threshold=vad.threshold,
                source_format="wav",
                reason="empty_wav",
            )

        total = 0.0
        peak = 0.0
        max_abs = float((1 << (sample_width * 8 - 1)) - 1) if sample_width > 1 else 128.0
        for index in range(0, len(raw_frames), sample_width):
            chunk = raw_frames[index : index + sample_width]
            if sample_width == 1:
                sample = chunk[0] - 128
            else:
                sample = int.from_bytes(chunk, byteorder="little", signed=True)
            normalized = min(abs(sample) / max_abs, 1.0)
            total += normalized * normalized
            peak = max(peak, normalized)

        rms = math.sqrt(total / sample_count)
        duration_ms = int(round((frame_count / frame_rate) * 1000))
        duration_per_channel_ms = int(round((sample_count / max(channels, 1) / frame_rate) * 1000))
        speech_detected = rms >= vad.threshold and duration_per_channel_ms >= vad.min_speech_ms
        silence_detected = not speech_detected and duration_per_channel_ms >= vad.min_silence_ms
        reason = "speech_threshold_met" if speech_detected else "below_speech_threshold"
        if not speech_detected and duration_per_channel_ms < vad.min_speech_ms:
            reason = "below_min_speech_duration"

        return VadAnalysisResult(
            speech_detected=speech_detected,
            silence_detected=silence_detected,
            rms=rms,
            peak=peak,
            duration_ms=duration_ms,
            threshold=vad.threshold,
            source_format=f"wav/{sample_width * 8}bit/{channels}ch",
            reason=reason,
        )


class WakeWordDetector:
    def __init__(self, voice: VoiceConfig) -> None:
        self.voice = voice

    def detect(self, transcript: str) -> WakeWordResult:
        wake_word = self.voice.wake_word
        phrase = wake_word.phrase.strip()
        if not wake_word.enabled:
            return WakeWordResult(False, phrase, True, 1.0, transcript)

        normalized_transcript = self._normalize(transcript)
        normalized_phrase = self._normalize(phrase)
        if not normalized_phrase:
            return WakeWordResult(True, phrase, False, 0.0, transcript)

        detected = normalized_phrase in normalized_transcript
        confidence = 1.0 if detected else 0.0
        return WakeWordResult(
            enabled=True,
            phrase=phrase,
            detected=detected and confidence >= wake_word.sensitivity,
            confidence=confidence,
            transcript=transcript,
        )

    @staticmethod
    def _normalize(value: str) -> str:
        lowered = value.lower()
        return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9A-Z\u00C0-\u024F' ]+", " ", lowered)).strip()


class ContinuousConversationState:
    def __init__(self, voice: VoiceConfig) -> None:
        self.voice = voice
        self._sessions: dict[str, VoiceSessionState] = {}

    def get(self, session_id: str, mode: VoiceModeName) -> VoiceSessionState:
        state = self._sessions.get(session_id)
        if state is None:
            state = VoiceSessionState(session_id=session_id, mode=mode)
            self._sessions[session_id] = state
        now = time.time()
        timeout = self.voice.modes.continuous_idle_timeout_seconds
        if state.activated and now - state.last_activity_at > timeout:
            state.activated = False
            state.assistant_speaking = False
        state.mode = mode
        return state

    def mark_activity(self, session_id: str, mode: VoiceModeName, *, activated: bool) -> VoiceSessionState:
        state = self.get(session_id, mode)
        now = time.time()
        state.last_activity_at = now
        if activated:
            state.activated = True
            state.last_wake_at = now
        return state

    def set_assistant_speaking(self, session_id: str, mode: VoiceModeName, speaking: bool) -> VoiceSessionState:
        state = self.get(session_id, mode)
        state.assistant_speaking = speaking
        state.last_activity_at = time.time()
        return state

    def reset(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
