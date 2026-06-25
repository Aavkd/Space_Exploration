import logging

import httpx
import pytest

from app.providers import llm as llm_module
from app.providers.llm import LlmExecutionError, LlmGateway


class FakeResponse:
    def __init__(self, payload: dict[str, object], *, status_code: int = 200, url: str = "http://test/api/generate") -> None:
        self._payload = payload
        self.status_code = status_code
        self._url = url

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("POST", self._url)
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("request failed", request=request, response=response)

    def json(self) -> dict[str, object]:
        return self._payload


class FakeHttpClient:
    scenarios: list[object] = []
    requests: list[dict[str, object]] = []

    def __init__(self, timeout: int) -> None:
        self.timeout = timeout

    def __enter__(self) -> "FakeHttpClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def post(self, url: str, json: dict[str, object]) -> FakeResponse:
        FakeHttpClient.requests.append(
            {
                "url": url,
                "json": json,
                "timeout": self.timeout,
            }
        )
        scenario = FakeHttpClient.scenarios.pop(0)
        if isinstance(scenario, Exception):
            raise scenario
        return scenario


def test_llm_gateway_calls_configured_ollama_provider(app_context, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    llm_config = app_context.config.providers.llm.model_copy(deep=True)
    llm_config.providers["ollama_local"].model = "llama3.1"
    gateway = LlmGateway(llm_config)

    FakeHttpClient.scenarios = [FakeResponse({"response": "Orbit confirmed."})]
    FakeHttpClient.requests = []
    monkeypatch.setattr(llm_module.httpx, "Client", FakeHttpClient)

    with caplog.at_level(logging.INFO):
        result = gateway.generate_text("Confirm orbit status.")

    assert result.text == "Orbit confirmed."
    assert result.provider_id == "ollama_local"
    assert result.provider_kind == "ollama"
    assert result.model == "llama3.1"
    assert result.fallback_used is False
    assert result.attempted_providers == ["ollama_local"]
    assert FakeHttpClient.requests[0]["url"].endswith("/api/generate")
    assert FakeHttpClient.requests[0]["json"]["model"] == "llama3.1"
    assert any("LLM request succeeded provider=ollama_local" in record.getMessage() for record in caplog.records)


def test_llm_gateway_uses_configured_fallback_on_provider_failure(
    app_context,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    llm_config = app_context.config.providers.llm.model_copy(deep=True)
    llm_config.providers["ollama_local"].model = "llama3.1"
    llm_config.providers["private_ollama"].enabled = True
    llm_config.providers["private_ollama"].model = "llama3.1:ops"
    llm_config.fallback_provider = "private_ollama"
    gateway = LlmGateway(llm_config)

    FakeHttpClient.scenarios = [
        httpx.ConnectError("primary unavailable"),
        FakeResponse({"response": "Fallback online."}, url="http://ollama.internal:11434/api/generate"),
    ]
    FakeHttpClient.requests = []
    monkeypatch.setattr(llm_module.httpx, "Client", FakeHttpClient)

    with caplog.at_level(logging.INFO):
        result = gateway.generate_text("Recover with fallback.")

    assert result.text == "Fallback online."
    assert result.provider_id == "private_ollama"
    assert result.fallback_used is True
    assert result.attempted_providers == ["ollama_local", "private_ollama"]
    assert len(FakeHttpClient.requests) == 2
    assert FakeHttpClient.requests[1]["url"] == "http://ollama.internal:11434/api/generate"
    assert any("LLM fallback triggered from_provider=ollama_local to_provider=private_ollama" in record.getMessage() for record in caplog.records)
    assert any("LLM fallback succeeded provider=private_ollama" in record.getMessage() for record in caplog.records)


def test_llm_gateway_returns_clear_error_when_model_is_missing(app_context) -> None:
    llm_config = app_context.config.providers.llm.model_copy(deep=True)
    llm_config.providers["ollama_local"].model = ""
    gateway = LlmGateway(llm_config)

    with pytest.raises(LlmExecutionError) as exc_info:
        gateway.generate_text("Why is the model missing?")

    assert "ollama_local" in str(exc_info.value)
    assert "must define a model in config" in str(exc_info.value)
