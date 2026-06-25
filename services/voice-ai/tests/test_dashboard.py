import json
from pathlib import Path


def test_dashboard_pages_are_served(client) -> None:
    response = client.get("/dashboard/providers")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Deep Space Voice Admin" in response.text


def test_dashboard_overview_endpoint_returns_summary(client) -> None:
    response = client.get("/api/v1/dashboard/overview")

    assert response.status_code == 200
    payload = response.json()
    assert payload["service"]["name"] == "deep-space-voice"
    assert "providers" in payload["pages"]
    assert payload["counts"]["personas"] >= 1


def test_provider_config_can_be_updated_via_api(client, config_root: Path) -> None:
    response = client.get("/api/v1/config/providers")
    assert response.status_code == 200

    providers = response.json()
    providers["llm"]["providers"]["ollama_local"]["model"] = "llama3.1"

    update_response = client.put("/api/v1/config/providers", json=providers)
    assert update_response.status_code == 200
    assert update_response.json()["llm"]["providers"]["ollama_local"]["model"] == "llama3.1"

    providers_file = config_root / "providers.json"
    persisted = json.loads(providers_file.read_text(encoding="utf-8"))
    assert persisted["llm"]["providers"]["ollama_local"]["model"] == "llama3.1"


def test_manifest_rejects_preset_source_rewrites(client) -> None:
    manifest_response = client.get("/api/v1/config/manifest")
    assert manifest_response.status_code == 200

    manifest = manifest_response.json()
    manifest["preset_sources"]["providers"] = "other-providers.json"

    update_response = client.put("/api/v1/config/manifest", json=manifest)
    assert update_response.status_code == 400
    assert "preset_sources cannot be changed" in update_response.json()["detail"]
