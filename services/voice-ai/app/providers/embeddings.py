from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import time
import unicodedata
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.config.models import EmbeddingsProvidersConfig, ProviderConnectionConfig


logger = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"[a-z0-9]+")


@dataclass(slots=True)
class EmbeddingExecutionResult:
    vector: list[float]
    provider_id: str
    provider_kind: str
    model: str
    duration_ms: float


class EmbeddingProviderError(RuntimeError):
    def __init__(self, message: str, *, provider_id: str, provider_kind: str, model: str) -> None:
        super().__init__(message)
        self.provider_id = provider_id
        self.provider_kind = provider_kind
        self.model = model


class EmbeddingProviderConfigurationError(EmbeddingProviderError):
    """Raised when an embedding provider is selected with unusable configuration."""


class EmbeddingProviderRequestError(EmbeddingProviderError):
    """Raised when an embedding provider request fails."""


class EmbeddingProvider(Protocol):
    provider_id: str
    provider_kind: str
    model: str

    def embed_text(self, text: str) -> tuple[list[float], float]:
        """Return an embedding vector and provider duration in milliseconds."""


class BaseEmbeddingProvider(ABC):
    def __init__(self, provider_id: str, config: ProviderConnectionConfig) -> None:
        self.provider_id = provider_id
        self.provider_kind = config.kind
        self.endpoint = config.endpoint.rstrip("/")
        self.model = config.model.strip()
        self.api_key_env = config.api_key_env
        self.timeout_seconds = config.timeout_seconds
        self.options = dict(config.options)

    def _raise_configuration_error(self, message: str) -> None:
        raise EmbeddingProviderConfigurationError(
            message,
            provider_id=self.provider_id,
            provider_kind=self.provider_kind,
            model=self.model,
        )

    def _raise_request_error(self, message: str) -> None:
        raise EmbeddingProviderRequestError(
            message,
            provider_id=self.provider_id,
            provider_kind=self.provider_kind,
            model=self.model,
        )

    def _require_endpoint(self) -> None:
        if not self.endpoint:
            self._raise_configuration_error(f"Embedding provider '{self.provider_id}' must define an endpoint.")

    def _require_model(self) -> None:
        if not self.model:
            self._raise_configuration_error(f"Embedding provider '{self.provider_id}' must define a model in config.")

    def _require_api_key(self) -> str:
        if not self.api_key_env:
            self._raise_configuration_error(f"Embedding provider '{self.provider_id}' must define api_key_env.")
        api_key = os.getenv(self.api_key_env, "").strip()
        if not api_key:
            self._raise_configuration_error(
                f"Environment variable '{self.api_key_env}' is required for embedding provider '{self.provider_id}'."
            )
        return api_key

    @abstractmethod
    def embed_text(self, text: str) -> tuple[list[float], float]:
        raise NotImplementedError


class HashingEmbeddingProvider(BaseEmbeddingProvider):
    """Deterministic local embeddings with no external runtime dependency.

    This is intentionally modest: it gives the V1 memory store a robust local
    baseline for indexing, tests, and dry-run inspection. Higher quality local
    models can be selected through the sentence-transformers provider.
    """

    def __init__(self, provider_id: str, config: ProviderConnectionConfig) -> None:
        super().__init__(provider_id, config)
        dimensions = int(self.options.get("dimensions", 384))
        if dimensions < 32 or dimensions > 4096:
            self._raise_configuration_error("Hashing embeddings dimensions must be between 32 and 4096.")
        self.dimensions = dimensions
        if not self.model:
            self.model = f"hashing-{dimensions}"

    def embed_text(self, text: str) -> tuple[list[float], float]:
        started_at = time.perf_counter()
        vector = [0.0] * self.dimensions
        tokens = _tokenize(text)
        features = tokens + [_stem_token(token) for token in tokens]
        features += _char_ngrams(" ".join(tokens), min_n=3, max_n=5)

        for feature in features:
            if not feature:
                continue
            digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
            bucket = int.from_bytes(digest[:4], "big") % self.dimensions
            sign = 1.0 if digest[4] & 1 else -1.0
            vector[bucket] += sign

        vector = _normalize(vector)
        return vector, (time.perf_counter() - started_at) * 1000


class SentenceTransformersEmbeddingProvider(BaseEmbeddingProvider):
    _models: dict[str, object] = {}

    def embed_text(self, text: str) -> tuple[list[float], float]:
        self._require_model()
        started_at = time.perf_counter()
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            self._raise_configuration_error(
                "sentence-transformers is not installed. Install it or select the local hashing provider."
            )

        model = self._models.get(self.model)
        if model is None:
            model = SentenceTransformer(self.model)
            self._models[self.model] = model

        embedding = model.encode(text, normalize_embeddings=True)
        vector = [float(value) for value in embedding.tolist()]
        return vector, (time.perf_counter() - started_at) * 1000


class OpenAIEmbeddingProvider(BaseEmbeddingProvider):
    def embed_text(self, text: str) -> tuple[list[float], float]:
        self._require_endpoint()
        self._require_model()
        api_key = self._require_api_key()
        started_at = time.perf_counter()
        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = client.post(
                    self.endpoint,
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={"model": self.model, "input": text},
                )
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code if exc.response is not None else "unknown"
            self._raise_request_error(f"OpenAI embedding provider '{self.provider_id}' returned HTTP {status_code}.")
        except httpx.HTTPError as exc:
            self._raise_request_error(f"OpenAI embedding provider '{self.provider_id}' request failed: {exc}")

        try:
            data = response.json()
            vector = data["data"][0]["embedding"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            self._raise_request_error(f"OpenAI embedding provider '{self.provider_id}' returned invalid JSON: {exc}")

        return _normalize([float(value) for value in vector]), (time.perf_counter() - started_at) * 1000


class EmbeddingsGateway:
    def __init__(self, config: EmbeddingsProvidersConfig) -> None:
        self._config = config

    @property
    def default_provider_id(self) -> str:
        return self._config.default_provider

    def embed_text(self, text: str, *, provider_id: str = "") -> EmbeddingExecutionResult:
        active_provider_id = provider_id or self._config.default_provider
        if not active_provider_id:
            raise EmbeddingProviderConfigurationError(
                "No active embedding provider is configured.",
                provider_id="",
                provider_kind="unknown",
                model="",
            )

        provider = self._create_provider(active_provider_id)
        logger.info(
            "Embedding request started provider=%s kind=%s model=%s",
            provider.provider_id,
            provider.provider_kind,
            provider.model or "<unset>",
        )
        vector, duration_ms = provider.embed_text(text.strip())
        logger.info(
            "Embedding request succeeded provider=%s kind=%s model=%s dimensions=%s duration_ms=%.2f",
            provider.provider_id,
            provider.provider_kind,
            provider.model or "<unset>",
            len(vector),
            duration_ms,
        )
        return EmbeddingExecutionResult(
            vector=vector,
            provider_id=provider.provider_id,
            provider_kind=provider.provider_kind,
            model=provider.model,
            duration_ms=duration_ms,
        )

    def _create_provider(self, provider_id: str) -> EmbeddingProvider:
        provider_config = self._config.providers.get(provider_id)
        if provider_config is None:
            raise EmbeddingProviderConfigurationError(
                f"Provider '{provider_id}' is not declared in embeddings.providers.",
                provider_id=provider_id,
                provider_kind="unknown",
                model="",
            )
        if not provider_config.enabled:
            raise EmbeddingProviderConfigurationError(
                f"Provider '{provider_id}' is disabled in config.",
                provider_id=provider_id,
                provider_kind=provider_config.kind,
                model=provider_config.model,
            )

        if provider_config.kind == "hashing":
            return HashingEmbeddingProvider(provider_id, provider_config)
        if provider_config.kind == "sentence-transformers":
            return SentenceTransformersEmbeddingProvider(provider_id, provider_config)
        if provider_config.kind == "openai":
            return OpenAIEmbeddingProvider(provider_id, provider_config)

        raise EmbeddingProviderConfigurationError(
            f"Provider '{provider_id}' uses unsupported embedding kind '{provider_config.kind}'.",
            provider_id=provider_id,
            provider_kind=provider_config.kind,
            model=provider_config.model,
        )


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return sum(a * b for a, b in zip(left, right))


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm <= 0:
        return vector
    return [value / norm for value in vector]


def _tokenize(text: str) -> list[str]:
    normalized = unicodedata.normalize("NFKD", text.lower()).encode("ascii", "ignore").decode("ascii")
    return _TOKEN_RE.findall(normalized)


def _stem_token(token: str) -> str:
    for suffix in ("ements", "ement", "ations", "ation", "ingly", "edly", "ing", "ies", "es", "s"):
        if len(token) > len(suffix) + 2 and token.endswith(suffix):
            return token[: -len(suffix)]
    return token


def _char_ngrams(text: str, *, min_n: int, max_n: int) -> list[str]:
    compact = re.sub(r"\s+", " ", text.strip())
    grams: list[str] = []
    for size in range(min_n, max_n + 1):
        grams.extend(compact[index : index + size] for index in range(0, max(0, len(compact) - size + 1)))
    return grams
