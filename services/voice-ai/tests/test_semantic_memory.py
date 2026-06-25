from __future__ import annotations

import math
from pathlib import Path

from fastapi.testclient import TestClient

from app.config.models import EmbeddingsProvidersConfig, ProviderConnectionConfig
from app.memory import MemoryManager
from app.providers.embeddings import EmbeddingsGateway


def _gateway() -> EmbeddingsGateway:
    return EmbeddingsGateway(
        EmbeddingsProvidersConfig(
            providers={
                "local": ProviderConnectionConfig(
                    enabled=True,
                    kind="hashing",
                    model="hashing-128",
                    options={"dimensions": 128},
                )
            },
            default_provider="local",
        )
    )


def test_hashing_embedding_provider_is_stable_and_normalized() -> None:
    gateway = _gateway()

    first = gateway.embed_text("blue nebula route")
    second = gateway.embed_text("blue nebula route")

    assert first.provider_id == "local"
    assert first.provider_kind == "hashing"
    assert first.model == "hashing-128"
    assert len(first.vector) == 128
    assert first.vector == second.vector
    assert math.isclose(math.sqrt(sum(value * value for value in first.vector)), 1.0)


def test_memory_manager_indexes_and_searches_relevant_memories(tmp_path: Path) -> None:
    manager = MemoryManager.from_db_path(tmp_path / "memory.db", embeddings=_gateway())
    relevant = manager.create_memory_entry(
        content="Captain Mira prefers the blue nebula route.",
        tags=["navigation", "mira"],
    )
    manager.create_memory_entry(content="The galley inventory includes mineral water.", tags=["supplies"])

    results = manager.search_relevant_memories("Which blue nebula route does Mira prefer?", limit=2)

    assert results
    assert results[0]["id"] == relevant["id"]
    assert "blue nebula route" in results[0]["content"]
    assert results[0]["embedding"]["provider_id"] == "local"
    assert manager.get_stats()["indexed_memories"] == 2


def test_memory_search_api_returns_relevant_memory(client: TestClient) -> None:
    created = client.post(
        "/api/v1/memory/entries",
        json={
            "content": "The narrator remembers that the traveler loves violet stars.",
            "tags": ["traveler", "stars"],
        },
    )
    assert created.status_code == 201

    response = client.get(
        "/api/v1/memory/search",
        params={"query": "What violet stars does the traveler love?", "limit": 3},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"]
    assert payload["items"][0]["content"] == "The narrator remembers that the traveler loves violet stars."
    assert payload["items"][0]["embedding"]["provider_id"] == "local-embeddings"


class _FakeResponse:
    status_code = 200

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict[str, str]:
        return {"response": "I remember the blue nebula route."}


class _FakeLlmClient:
    requests: list[dict[str, object]] = []

    def __init__(self, timeout: int) -> None:
        self.timeout = timeout

    def __enter__(self) -> "_FakeLlmClient":
        return self

    def __exit__(self, *args) -> bool:
        return False

    def post(self, url: str, json: dict[str, object]) -> _FakeResponse:
        self.requests.append({"url": url, "json": json, "timeout": self.timeout})
        return _FakeResponse()


def test_text_conversation_dry_run_exposes_injected_memories(
    client: TestClient,
    monkeypatch,
) -> None:
    from app.providers import llm as llm_module

    created = client.post(
        "/api/v1/memory/entries",
        json={
            "content": "Captain Mira prefers the blue nebula route.",
            "persona_id": "eternity-infinity",
            "tags": ["navigation"],
        },
    )
    assert created.status_code == 201

    _FakeLlmClient.requests = []
    monkeypatch.setattr(llm_module.httpx, "Client", _FakeLlmClient)

    response = client.post(
        "/api/v1/conversation/text",
        json={
            "message": "Which blue nebula route does Mira prefer?",
            "persona_id": "eternity-infinity",
            "dry_run": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["dry_run"]["injected_memories"]
    assert payload["dry_run"]["injected_memories"][0]["content"] == "Captain Mira prefers the blue nebula route."
    assert "Captain Mira prefers the blue nebula route." in payload["dry_run"]["prompt_final"]
    assert "Captain Mira prefers the blue nebula route." in str(_FakeLlmClient.requests[0]["json"]["prompt"])
