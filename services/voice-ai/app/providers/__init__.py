"""Provider abstractions for LLM, STT, TTS, and embeddings backends."""

SUPPORTED_PROVIDER_DOMAINS = ("llm", "stt", "tts", "embeddings")

from app.providers.llm import (
    LlmExecutionError,
    LlmExecutionResult,
    LlmGateway,
    LlmProvider,
    LlmProviderConfigurationError,
    LlmProviderError,
    LlmProviderNotImplementedError,
    LlmProviderRequestError,
)
from app.providers.stt import (
    SttExecutionError,
    SttExecutionResult,
    SttGateway,
    SttProvider,
    SttProviderConfigurationError,
    SttProviderError,
    SttProviderNotImplementedError,
    SttProviderRequestError,
)

__all__ = [
    "SUPPORTED_PROVIDER_DOMAINS",
    "LlmExecutionError",
    "LlmExecutionResult",
    "LlmGateway",
    "LlmProvider",
    "LlmProviderConfigurationError",
    "LlmProviderError",
    "LlmProviderNotImplementedError",
    "LlmProviderRequestError",
    "SttExecutionError",
    "SttExecutionResult",
    "SttGateway",
    "SttProvider",
    "SttProviderConfigurationError",
    "SttProviderError",
    "SttProviderNotImplementedError",
    "SttProviderRequestError",
]
