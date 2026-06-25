import httpx
import pytest

from app.providers import llm as llm_module
from app.providers import stt as stt_module


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
        if callable(scenario):
            scenario = scenario(url, json)
        return scenario


def test_text_conversation_endpoint_executes_active_provider_with_dry_run(
    client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    providers = client.get("/api/v1/config/providers").json()
    providers["llm"]["providers"]["ollama_local"]["model"] = "llama3.1"
    update_response = client.put("/api/v1/config/providers", json=providers)
    assert update_response.status_code == 200

    def persona_aware_response(url: str, json_payload: dict[str, object]) -> FakeResponse:
        assert url.endswith("/api/generate")
        prompt = str(json_payload["prompt"])
        if "Bridge Operations" in prompt:
            return FakeResponse({"response": "Bridge Operations standing by."})
        return FakeResponse({"response": "Eternity & Infinity online."})

    FakeHttpClient.scenarios = [persona_aware_response]
    FakeHttpClient.requests = []
    monkeypatch.setattr(llm_module.httpx, "Client", FakeHttpClient)

    response = client.post(
        "/api/v1/conversation/text",
        json={
            "message": "Status report.",
            "persona_id": "bridge-ops",
            "dry_run": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["persona_id"] == "bridge-ops"
    assert payload["persona"]["name"] == "Bridge Operations"
    assert payload["persona"]["style"]["tone"] == "operational"
    assert payload["persona"]["memory"]["scope"] == "shared"
    assert payload["persona"]["tools"]["mode"] == "future"
    assert payload["response_text"] == "Bridge Operations standing by."
    assert payload["provider"]["id"] == "ollama_local"
    assert payload["provider"]["kind"] == "ollama"
    assert payload["provider"]["model"] == "llama3.1"
    assert payload["fallback_used"] is False
    assert payload["attempted_providers"] == ["ollama_local"]
    assert payload["dry_run"]["enabled"] is True
    assert "Bridge Operations" in payload["dry_run"]["prompt_final"]
    assert "Avoid dramatic narration." in payload["dry_run"]["prompt_final"]
    assert "Memory scope: shared" in payload["dry_run"]["prompt_final"]
    assert "Tool availability: future" in payload["dry_run"]["prompt_final"]
    assert "Status report." in payload["dry_run"]["prompt_final"]
    assert payload["timings"]["prompt_build_ms"] >= 0
    assert payload["timings"]["llm_total_ms"] >= 0
    assert payload["timings"]["total_ms"] >= 0
    assert "Bridge Operations" in str(FakeHttpClient.requests[0]["json"]["prompt"])


def test_text_conversation_endpoint_returns_clear_provider_error(client) -> None:
    providers = client.get("/api/v1/config/providers").json()
    providers["llm"]["providers"]["ollama_local"]["model"] = ""
    update_response = client.put("/api/v1/config/providers", json=providers)
    assert update_response.status_code == 200

    response = client.post("/api/v1/conversation/text", json={"message": "Status report."})

    assert response.status_code == 502
    assert "ollama_local" in response.json()["detail"]
    assert "must define a model in config" in response.json()["detail"]


def test_text_conversation_endpoint_rejects_unknown_persona(client) -> None:
    response = client.post(
        "/api/v1/conversation/text",
        json={
            "message": "Status report.",
            "persona_id": "missing-persona",
        },
    )

    assert response.status_code == 400
    assert "missing-persona" in response.json()["detail"]


def test_audio_transcription_endpoint_returns_transcript(client) -> None:
    def fake_transcribe_audio(
        audio_bytes: bytes,
        *,
        content_type: str = "",
        filename: str = "",
        engine_id: str = "",
    ) -> stt_module.SttExecutionResult:
        assert audio_bytes == b"fake-webm-audio"
        assert content_type == "audio/webm"
        assert filename == "browser-capture.webm"
        assert engine_id == ""
        return stt_module.SttExecutionResult(
            text="Bonjour depuis le cockpit.",
            language="fr",
            language_probability=0.9732,
            language_supported=True,
            engine_id="faster-whisper",
            engine_backend="faster-whisper",
            model="base",
            audio_duration_seconds=1.84,
            audio_size_bytes=len(audio_bytes),
            content_type=content_type,
            transcription_duration_ms=182.4,
            total_duration_ms=195.7,
        )

    client.app.state.app_context.stt.transcribe_audio = fake_transcribe_audio

    response = client.post(
        "/api/v1/conversation/transcribe",
        content=b"fake-webm-audio",
        headers={
            "Content-Type": "audio/webm",
            "X-Audio-Filename": "browser-capture.webm",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["transcript"]["text"] == "Bonjour depuis le cockpit."
    assert payload["transcript"]["language"] == "fr"
    assert payload["transcript"]["language_supported"] is True
    assert payload["engine"]["id"] == "faster-whisper"
    assert payload["engine"]["backend"] == "faster-whisper"
    assert payload["audio"]["content_type"] == "audio/webm"
    assert payload["audio"]["size_bytes"] == len(b"fake-webm-audio")
    assert payload["audio"]["debug_capture_enabled"] is False
    assert payload["timings"]["transcription_ms"] == 182.4
    assert payload["timings"]["total_ms"] == 195.7


def test_audio_transcription_endpoint_rejects_empty_audio(client) -> None:
    response = client.post("/api/v1/conversation/transcribe", content=b"", headers={"Content-Type": "audio/webm"})

    assert response.status_code == 400
    assert response.json()["detail"] == "Audio payload is empty."
