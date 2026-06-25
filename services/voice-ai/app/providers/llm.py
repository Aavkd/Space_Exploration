from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.config.models import LlmProvidersConfig, ProviderConnectionConfig


logger = logging.getLogger(__name__)

_RESERVED_OLLAMA_OPTION_KEYS = {"transport"}
_RESERVED_PROVIDER_KINDS = {"openrouter", "openai", "anthropic", "gemini"}


@dataclass(slots=True)
class LlmExecutionResult:
    text: str
    provider_id: str
    provider_kind: str
    model: str
    provider_duration_ms: float
    total_duration_ms: float
    fallback_used: bool
    attempted_providers: list[str]


class LlmProviderError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        provider_id: str,
        provider_kind: str,
        model: str,
    ) -> None:
        super().__init__(message)
        self.provider_id = provider_id
        self.provider_kind = provider_kind
        self.model = model


class LlmProviderConfigurationError(LlmProviderError):
    """Raised when a provider is selected with an unusable configuration."""


class LlmProviderRequestError(LlmProviderError):
    """Raised when a provider request fails after configuration succeeds."""


class LlmProviderNotImplementedError(LlmProviderError):
    """Raised when a reserved provider kind is configured but not implemented yet."""


class LlmExecutionError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        primary_provider_id: str,
        fallback_provider_id: str = "",
        primary_error: str = "",
        fallback_error: str = "",
    ) -> None:
        super().__init__(message)
        self.primary_provider_id = primary_provider_id
        self.fallback_provider_id = fallback_provider_id
        self.primary_error = primary_error
        self.fallback_error = fallback_error


class LlmProvider(Protocol):
    provider_id: str
    provider_kind: str
    model: str

    def generate_text(self, prompt: str) -> tuple[str, float]:
        """Return generated text and provider duration in milliseconds."""


class BaseLlmProvider(ABC):
    def __init__(self, provider_id: str, config: ProviderConnectionConfig) -> None:
        self.provider_id = provider_id
        self.provider_kind = config.kind
        self.endpoint = config.endpoint.rstrip("/")
        self.model = config.model.strip()
        self.timeout_seconds = config.timeout_seconds
        self.options = dict(config.options)

    def _raise_configuration_error(self, message: str) -> None:
        raise LlmProviderConfigurationError(
            message,
            provider_id=self.provider_id,
            provider_kind=self.provider_kind,
            model=self.model,
        )

    def _raise_request_error(self, message: str) -> None:
        raise LlmProviderRequestError(
            message,
            provider_id=self.provider_id,
            provider_kind=self.provider_kind,
            model=self.model,
        )

    def _raise_not_implemented_error(self, message: str) -> None:
        raise LlmProviderNotImplementedError(
            message,
            provider_id=self.provider_id,
            provider_kind=self.provider_kind,
            model=self.model,
        )

    def _require_endpoint(self) -> None:
        if not self.endpoint:
            self._raise_configuration_error(f"Provider '{self.provider_id}' must define an endpoint.")

    def _require_model(self) -> None:
        if not self.model:
            self._raise_configuration_error(f"Provider '{self.provider_id}' must define a model in config.")

    @abstractmethod
    def generate_text(self, prompt: str) -> tuple[str, float]:
        raise NotImplementedError


class OllamaLlmProvider(BaseLlmProvider):
    def generate_text(self, prompt: str) -> tuple[str, float]:
        self._require_endpoint()
        self._require_model()

        payload: dict[str, object] = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
        }
        request_options = {
            key: value for key, value in self.options.items() if key not in _RESERVED_OLLAMA_OPTION_KEYS
        }
        if request_options:
            payload["options"] = request_options

        started_at = time.perf_counter()
        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = client.post(f"{self.endpoint}/api/generate", json=payload)
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code if exc.response is not None else "unknown"
            self._raise_request_error(
                f"Ollama provider '{self.provider_id}' returned HTTP {status_code}."
            )
        except httpx.HTTPError as exc:
            self._raise_request_error(f"Ollama provider '{self.provider_id}' request failed: {exc}")

        try:
            data = response.json()
        except ValueError as exc:
            self._raise_request_error(
                f"Ollama provider '{self.provider_id}' returned invalid JSON: {exc}"
            )

        text = data.get("response")
        if not isinstance(text, str) or not text.strip():
            self._raise_request_error(
                f"Ollama provider '{self.provider_id}' returned an empty text response."
            )

        duration_ms = (time.perf_counter() - started_at) * 1000
        return text.strip(), duration_ms


class ReservedLlmProvider(BaseLlmProvider):
    def generate_text(self, prompt: str) -> tuple[str, float]:
        del prompt
        self._raise_not_implemented_error(
            f"Provider kind '{self.provider_kind}' is reserved for provider '{self.provider_id}' but is not implemented yet."
        )


class LlmGateway:
    def __init__(self, config: LlmProvidersConfig) -> None:
        self._config = config

    def generate_text(self, prompt: str, *, provider_id: str = "") -> LlmExecutionResult:
        primary_provider_id = provider_id or self._config.default_provider
        if not primary_provider_id:
            raise LlmExecutionError(
                "No active LLM provider is configured.",
                primary_provider_id="",
            )

        total_started_at = time.perf_counter()

        try:
            primary_text, primary_duration_ms = self._call_provider(primary_provider_id, prompt)
        except LlmProviderError as primary_error:
            fallback_provider_id = self._resolve_fallback_provider(primary_provider_id)
            if not fallback_provider_id:
                raise LlmExecutionError(
                    f"LLM request failed on provider '{primary_provider_id}': {primary_error}",
                    primary_provider_id=primary_provider_id,
                    primary_error=str(primary_error),
                ) from primary_error

            logger.warning(
                "LLM fallback triggered from_provider=%s to_provider=%s reason=%s",
                primary_provider_id,
                fallback_provider_id,
                primary_error,
            )

            try:
                fallback_text, fallback_duration_ms = self._call_provider(fallback_provider_id, prompt)
            except LlmProviderError as fallback_error:
                raise LlmExecutionError(
                    "LLM request failed on provider "
                    f"'{primary_provider_id}' and fallback '{fallback_provider_id}': "
                    f"primary={primary_error}; fallback={fallback_error}",
                    primary_provider_id=primary_provider_id,
                    fallback_provider_id=fallback_provider_id,
                    primary_error=str(primary_error),
                    fallback_error=str(fallback_error),
                ) from fallback_error

            total_duration_ms = (time.perf_counter() - total_started_at) * 1000
            fallback_provider = self._create_provider(fallback_provider_id)
            logger.info(
                "LLM fallback succeeded provider=%s kind=%s model=%s total_duration_ms=%.2f",
                fallback_provider.provider_id,
                fallback_provider.provider_kind,
                fallback_provider.model or "<unset>",
                total_duration_ms,
            )
            return LlmExecutionResult(
                text=fallback_text,
                provider_id=fallback_provider.provider_id,
                provider_kind=fallback_provider.provider_kind,
                model=fallback_provider.model,
                provider_duration_ms=fallback_duration_ms,
                total_duration_ms=total_duration_ms,
                fallback_used=True,
                attempted_providers=[primary_provider_id, fallback_provider_id],
            )

        total_duration_ms = (time.perf_counter() - total_started_at) * 1000
        primary_provider = self._create_provider(primary_provider_id)
        return LlmExecutionResult(
            text=primary_text,
            provider_id=primary_provider.provider_id,
            provider_kind=primary_provider.provider_kind,
            model=primary_provider.model,
            provider_duration_ms=primary_duration_ms,
            total_duration_ms=total_duration_ms,
            fallback_used=False,
            attempted_providers=[primary_provider_id],
        )

    def _resolve_fallback_provider(self, primary_provider_id: str) -> str:
        fallback_provider_id = self._config.fallback_provider
        if not fallback_provider_id or fallback_provider_id == primary_provider_id:
            return ""
        return fallback_provider_id

    def _call_provider(self, provider_id: str, prompt: str) -> tuple[str, float]:
        provider = self._create_provider(provider_id)
        started_at = time.perf_counter()
        logger.info(
            "LLM request started provider=%s kind=%s model=%s",
            provider.provider_id,
            provider.provider_kind,
            provider.model or "<unset>",
        )
        try:
            text, duration_ms = provider.generate_text(prompt)
        except LlmProviderError as exc:
            elapsed_ms = (time.perf_counter() - started_at) * 1000
            logger.warning(
                "LLM request failed provider=%s kind=%s model=%s duration_ms=%.2f error=%s",
                provider.provider_id,
                provider.provider_kind,
                provider.model or "<unset>",
                elapsed_ms,
                exc,
            )
            raise

        logger.info(
            "LLM request succeeded provider=%s kind=%s model=%s duration_ms=%.2f",
            provider.provider_id,
            provider.provider_kind,
            provider.model or "<unset>",
            duration_ms,
        )
        return text, duration_ms

    def _create_provider(self, provider_id: str) -> LlmProvider:
        provider_config = self._config.providers.get(provider_id)
        if provider_config is None:
            raise LlmProviderConfigurationError(
                f"Provider '{provider_id}' is not declared in llm.providers.",
                provider_id=provider_id,
                provider_kind="unknown",
                model="",
            )
        if not provider_config.enabled:
            raise LlmProviderConfigurationError(
                f"Provider '{provider_id}' is disabled in config.",
                provider_id=provider_id,
                provider_kind=provider_config.kind,
                model=provider_config.model,
            )

        if provider_config.kind == "ollama":
            return OllamaLlmProvider(provider_id, provider_config)
        if provider_config.kind in _RESERVED_PROVIDER_KINDS:
            return ReservedLlmProvider(provider_id, provider_config)

        raise LlmProviderConfigurationError(
            f"Provider '{provider_id}' uses unsupported kind '{provider_config.kind}'.",
            provider_id=provider_id,
            provider_kind=provider_config.kind,
            model=provider_config.model,
        )
